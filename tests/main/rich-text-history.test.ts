import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import {
  RICH_TEXT_HISTORY_ELAPSED_MS,
  RICH_TEXT_HISTORY_IDLE_MS,
  RICH_TEXT_HISTORY_LIMIT
} from '../../src/main/data/rich-text-history'
import type { RichTextDocumentReference } from '../../src/shared/contracts'

function after(iso: string, milliseconds: number): Date {
  return new Date(new Date(iso).getTime() + milliseconds)
}

describe('bounded rich-text history', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-rich-history-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  function noteDocument(): {
    reference: RichTextDocumentReference
    updatedAt: string
  } {
    const focus = database!.domain.focuses.create({ title: 'History test' })
    const [note] = focus.toSnapshot().notes
    return {
      reference: { type: 'note', id: note.id, field: 'content' },
      updatedAt: note.updatedAt
    }
  }

  it('keeps rapid small autosaves in one accumulator instead of one row per edit', () => {
    const { reference, updatedAt } = noteDocument()

    database!.domain.richTextDocuments.save(reference, 'F', after(updatedAt, 1))
    database!.domain.richTextDocuments.save(reference, 'Fi', after(updatedAt, 2))
    database!.domain.richTextDocuments.save(reference, 'First', after(updatedAt, 3))

    expect(database!.domain.richTextDocuments.get(reference)).toMatchObject({
      value: 'First',
      revision: 3
    })
    expect(database!.domain.richTextDocuments.history(reference)).toEqual([])

    const reader = new DatabaseSync(databasePath, { readOnly: true })
    expect(reader.prepare(
      `SELECT count(*) AS count, max(edits_since_snapshot) AS edits
       FROM rich_text_history_state WHERE entity_id = ?`
    ).get(reference.id)).toEqual({ count: 1, edits: 3 })
    reader.close()
  })

  it('captures the recoverable pre-edit document for a large replacement and clear', () => {
    const { reference, updatedAt } = noteDocument()
    const first = 'A'.repeat(600)
    const second = 'B'.repeat(600)

    database!.domain.richTextDocuments.save(reference, first, after(updatedAt, 1))
    database!.domain.richTextDocuments.save(reference, second, after(updatedAt, 2))
    database!.domain.richTextDocuments.save(reference, '', after(updatedAt, 3))

    expect(database!.domain.richTextDocuments.history(reference)).toMatchObject([
      { revision: 2, value: second, reason: 'destructive' },
      { revision: 1, value: first, reason: 'large-edit' }
    ])
  })

  it('recognizes a major change accumulated across many individually small edits', () => {
    const { reference, updatedAt } = noteDocument()
    let value = 'a'.repeat(400)
    database!.domain.richTextDocuments.save(reference, value, after(updatedAt, 1))

    for (let index = 0; index < 6; index += 1) {
      const start = index * 30
      value = `${value.slice(0, start)}${'b'.repeat(30)}${value.slice(start + 30)}`
      database!.domain.richTextDocuments.save(reference, value, after(updatedAt, index + 2))
    }

    expect(database!.domain.richTextDocuments.history(reference)).toMatchObject([
      {
        revision: 6,
        reason: 'accumulated',
        editCount: 6,
        value: `${'b'.repeat(150)}${'a'.repeat(250)}`
      }
    ])
  })

  it('creates a session boundary after idle editing without snapshotting each save', () => {
    const { reference, updatedAt } = noteDocument()
    const base = 'a'.repeat(200)
    const firstEdit = `${'b'.repeat(10)}${base.slice(10)}`
    const secondEdit = `${'b'.repeat(20)}${base.slice(20)}`
    database!.domain.richTextDocuments.save(reference, base, after(updatedAt, 1))
    database!.domain.richTextDocuments.save(reference, firstEdit, after(updatedAt, 2))
    database!.domain.richTextDocuments.save(
      reference,
      secondEdit,
      after(updatedAt, RICH_TEXT_HISTORY_IDLE_MS + 3)
    )

    expect(database!.domain.richTextDocuments.history(reference)).toMatchObject([
      { revision: 2, value: firstEdit, reason: 'idle' }
    ])
  })

  it('checkpoints a continuously active edit session after its elapsed limit', () => {
    const { reference, updatedAt } = noteDocument()
    const base = 'a'.repeat(200)
    database!.domain.richTextDocuments.save(reference, base, after(updatedAt, 1))

    let value = base
    for (let index = 1; index <= 4; index += 1) {
      const start = (index - 1) * 4
      value = `${value.slice(0, start)}${'b'.repeat(4)}${value.slice(start + 4)}`
      database!.domain.richTextDocuments.save(
        reference,
        value,
        after(updatedAt, (RICH_TEXT_HISTORY_ELAPSED_MS / 4) * index + 1)
      )
    }

    expect(database!.domain.richTextDocuments.history(reference)).toMatchObject([
      { revision: 4, reason: 'elapsed' }
    ])
  })

  it('retains only the newest bounded set of recovery documents', () => {
    const { reference, updatedAt } = noteDocument()
    for (let revision = 1; revision <= RICH_TEXT_HISTORY_LIMIT + 2; revision += 1) {
      database!.domain.richTextDocuments.save(
        reference,
        (revision % 2 === 0 ? 'B' : 'A').repeat(600),
        after(updatedAt, revision)
      )
    }

    const history = database!.domain.richTextDocuments.history(reference)
    expect(history).toHaveLength(RICH_TEXT_HISTORY_LIMIT)
    expect(history.at(0)?.revision).toBe(RICH_TEXT_HISTORY_LIMIT + 1)
    expect(history.at(-1)?.revision).toBe(2)
  })

  it('uses the same history boundary for Focus descriptions and Update observations', () => {
    const focus = database!.domain.focuses.create({
      title: 'Shared boundary',
      description: 'Important focus description'
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery',
      reviewFrequencyDays: 7
    })
    const update = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Important update observation'
    })

    focus.update({ description: '' })
    update.update({ observation: '' })

    expect(database!.domain.richTextDocuments.history({
      type: 'focus', id: focus.id, field: 'description'
    })).toMatchObject([{
      revision: 0,
      value: 'Important focus description',
      reason: 'destructive'
    }])
    expect(database!.domain.richTextDocuments.history({
      type: 'update', id: update.id, field: 'observation'
    })).toMatchObject([{
      revision: 0,
      value: 'Important update observation',
      reason: 'destructive'
    }])
  })

  it('tracks Routine attestation rich-text notes and cascades their recovery state', () => {
    const focus = database!.domain.focuses.create({ title: 'Routine history' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Quality checks',
      reviewFrequencyDays: 7
    })
    const routine = database!.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Inspect evidence',
      scheduleWeekdays: ['thursday'],
      checklist: [{ inspection: 'Verify the evidence.' }]
    }, new Date('2026-01-01T08:00:00.000Z'))
    const attestationId = routine.snapshot('2026-01-01').currentRun!.items[0].id

    database!.domain.routines.attestCellItem(attestationId, {
      resolution: 'pending',
      note: 'A'.repeat(600)
    }, new Date('2026-01-01T09:00:00.000Z'))
    database!.domain.routines.attestCellItem(attestationId, {
      resolution: 'pending',
      note: 'B'.repeat(600)
    }, new Date('2026-01-01T09:01:00.000Z'))

    expect(database!.domain.routines.itemNoteHistory(attestationId)).toMatchObject([{
      reference: { type: 'routine-attestation', id: attestationId, field: 'note' },
      revision: 1,
      value: 'A'.repeat(600),
      reason: 'large-edit'
    }])

    expect(database!.domain.routines.delete(routine.id)).toBe(true)
    const reader = new DatabaseSync(databasePath, { readOnly: true })
    expect(reader.prepare(
      `SELECT count(*) AS count FROM rich_text_history
       WHERE document_type = 'routine-attestation-note' AND entity_id = ?`
    ).get(attestationId)).toEqual({ count: 0 })
    expect(reader.prepare(
      `SELECT count(*) AS count FROM rich_text_history_state
       WHERE document_type = 'routine-attestation-note' AND entity_id = ?`
    ).get(attestationId)).toEqual({ count: 0 })
    reader.close()
  })
})
