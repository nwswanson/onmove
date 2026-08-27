import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { resolveOnMoveEntityLink } from '../../src/main/entity-links'
import {
  onMoveEntityUrl,
  onMoveMarkdownEntityLink,
  parseOnMoveEntityUrl
} from '../../src/shared/onmove-url'

describe('OnMove entity URLs', () => {
  it('round-trips every public entity kind through one strict canonical form', () => {
    for (const kind of [
      'focus', 'thread', 'commitment', 'routine', 'update', 'todo', 'note', 'subject'
    ] as const) {
      const url = onMoveEntityUrl(kind, 24)
      expect(url).toBe(`onmove://${kind}/24`)
      expect(parseOnMoveEntityUrl(url)).toMatchObject({ kind, id: 24 })
    }
  })

  it('rejects malformed or state-bearing URLs and safely formats Markdown labels', () => {
    expect(parseOnMoveEntityUrl('https://thread/24')).toBeNull()
    expect(parseOnMoveEntityUrl('onmove://thread/0')).toBeNull()
    expect(parseOnMoveEntityUrl('onmove://thread/024')).toBeNull()
    expect(parseOnMoveEntityUrl('onmove://thread/24/child')).toBeNull()
    expect(parseOnMoveEntityUrl('onmove://thread/24?subject=2')).toBeNull()
    expect(parseOnMoveEntityUrl('onmove://unknown/24')).toBeNull()
    expect(onMoveMarkdownEntityLink('thread', 24, 'Plan [Q4]')).toBe(
      '[Plan \\[Q4\\] #T24](onmove://thread/24)'
    )
  })
})

describe('OnMove entity-link hierarchy resolution', () => {
  let directory: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-entity-link-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('resolves child records to one atomic Focus workspace destination', () => {
    const focus = database.domain.focuses.create({ title: 'Delivery' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Execution',
      reviewFrequencyDays: 7
    }).snapshot()
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: 'Ship'
    }).snapshot()
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Inspect release',
      scheduleWeekdays: ['friday'],
      checklist: [{ inspection: 'Verify release readiness.' }]
    }).snapshot()
    const update = database.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      observation: 'Ready'
    }).toSnapshot()
    const todo = database.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Prepare notes'
    }).toSnapshot()
    const note = database.domain.notes.list({ type: 'commitment', id: commitment.id })[0]
    const subject = database.domain.threadScopes.addSubject(thread.id, { name: 'North' }).subjects[0]

    const resolve = (url: string) => {
      const parsed = parseOnMoveEntityUrl(url)
      if (!parsed) throw new Error('test URL did not parse')
      return resolveOnMoveEntityLink(database.domain, parsed)
    }

    expect(resolve(onMoveEntityUrl('focus', focus.id))).toMatchObject({
      focusId: focus.id, threadId: null, commitmentId: null
    })
    expect(resolve(onMoveEntityUrl('thread', thread.id))).toMatchObject({
      focusId: focus.id, threadId: thread.id, commitmentId: null
    })
    expect(resolve(onMoveEntityUrl('commitment', commitment.id))).toMatchObject({
      focusId: focus.id, threadId: thread.id, commitmentId: commitment.id
    })
    expect(resolve(onMoveEntityUrl('routine', routine.id))).toMatchObject({
      focusId: focus.id, threadId: thread.id, routineId: routine.id
    })
    expect(resolve(onMoveEntityUrl('update', update.id))).toMatchObject({
      focusId: focus.id, threadId: thread.id, commitmentId: commitment.id
    })
    expect(resolve(onMoveEntityUrl('todo', todo.id))).toMatchObject({
      focusId: focus.id, threadId: thread.id
    })
    expect(resolve(onMoveEntityUrl('note', note.id))).toMatchObject({
      focusId: focus.id, threadId: thread.id, commitmentId: commitment.id
    })
    expect(resolve(onMoveEntityUrl('subject', subject.id))).toMatchObject({
      focusId: focus.id, threadId: thread.id, subjectId: subject.id
    })
    expect(resolve('onmove://thread/999999')).toBeNull()
  })
})
