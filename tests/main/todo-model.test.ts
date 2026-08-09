import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('Todo model', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-todo-model-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates and edits aggregate Focus, Thread, and Commitment Todos', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
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
    const focusTodo = database!.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Align sponsors'
    })
    const threadTodo = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Prepare sprint review',
      dueDate: '2026-08-15'
    })
    const commitmentTodo = database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Draft examples',
      done: true
    })

    expect(focusTodo.toSnapshot()).toMatchObject({
      name: 'Align sponsors',
      parent: { type: 'focus', id: focus.id },
      dueDate: null,
      done: false,
      sort: [{ context: { type: 'focus', id: focus.id }, position: 1024 }]
    })
    expect(threadTodo.toSnapshot()).toMatchObject({
      dueDate: '2026-08-15',
      sort: [{ context: { type: 'thread', id: thread.id }, position: 1024 }]
    })
    expect(commitmentTodo.toSnapshot()).toMatchObject({
      done: true,
      sort: [{ context: { type: 'commitment', id: commitment.id }, position: 1024 }]
    })

    commitmentTodo.update({ name: 'Draft concrete examples', dueDate: '2026-08-20' })
      .setDone(false)
    expect(commitmentTodo.toSnapshot()).toMatchObject({
      name: 'Draft concrete examples',
      dueDate: '2026-08-20',
      done: false
    })
    commitmentTodo.update({ dueDate: null })
    expect(commitmentTodo.dueDate).toBeNull()
  })

  it('places scoped Todos independently in exact and aggregate lists', () => {
    const now = new Date('2026-08-09T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    }, now)
    const scoped = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      now
    )
    const cell = { scopeId: scoped.scopeId as number, subjectId: scoped.subjects[0].id }
    const aggregate = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Prepare aggregate report'
    }, now)
    const first = database!.domain.todos.create({
      parent: { type: 'thread-scope', id: thread.id, scope: cell },
      name: 'Review customer tickets'
    }, now)
    const second = database!.domain.todos.create({
      parent: { type: 'thread-scope', id: thread.id, scope: cell },
      name: 'Confirm customer owner'
    }, now)
    const commitmentTodo = database!.domain.todos.create({
      parent: { type: 'commitment-scope', id: commitment.id, scope: cell },
      name: 'Rewrite ticket examples'
    }, now)

    expect(first.sort).toEqual([
      { context: { type: 'thread', id: thread.id }, position: 2048 },
      {
        context: { type: 'thread-scope', id: thread.id, scope: cell },
        position: 1024
      }
    ])
    expect(commitmentTodo.sort).toEqual([
      { context: { type: 'commitment', id: commitment.id }, position: 1024 },
      {
        context: { type: 'commitment-scope', id: commitment.id, scope: cell },
        position: 1024
      }
    ])
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id }).map(({ id }) => id))
      .toEqual([aggregate.id, first.id, second.id])
    expect(database!.domain.todos.list({
      type: 'thread-scope',
      id: thread.id,
      scope: cell
    }).map(({ id }) => id)).toEqual([first.id, second.id])

    database!.domain.todos.reorder(
      { type: 'thread-scope', id: thread.id, scope: cell },
      [second.id, first.id],
      now
    )
    expect(database!.domain.todos.list({
      type: 'thread-scope',
      id: thread.id,
      scope: cell
    }).map(({ id }) => id)).toEqual([second.id, first.id])
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id }).map(({ id }) => id))
      .toEqual([aggregate.id, first.id, second.id])

    database!.domain.todos.reorder(
      { type: 'thread', id: thread.id },
      [second.id, aggregate.id, first.id],
      now
    )
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id }).map(({ id }) => id))
      .toEqual([second.id, aggregate.id, first.id])
    expect(database!.domain.todos.list({
      type: 'thread-scope',
      id: thread.id,
      scope: cell
    }).map(({ id }) => id)).toEqual([second.id, first.id])
  })

  it('reorders filtered subsets without moving hidden Todos out of their slots', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const context = { type: 'focus' as const, id: focus.id }
    const first = database!.domain.todos.create({ parent: context, name: 'First active' })
    const hiddenDone = database!.domain.todos.create({
      parent: context,
      name: 'Already done',
      done: true
    })
    const second = database!.domain.todos.create({
      parent: context,
      name: 'Second active',
      dueDate: '2026-08-20'
    })

    expect(database!.domain.todos.list(context, { done: false }).map(({ id }) => id))
      .toEqual([first.id, second.id])
    database!.domain.todos.reorder(context, [second.id, first.id])

    expect(database!.domain.todos.list(context).map(({ id }) => id))
      .toEqual([second.id, hiddenDone.id, first.id])
    expect(database!.domain.todos.list(context, { done: false }).map(({ id }) => id))
      .toEqual([second.id, first.id])
    expect(database!.domain.todos.list(context, {
      dueOnOrAfter: '2026-08-01',
      dueOnOrBefore: '2026-08-31'
    }).map(({ id }) => id)).toEqual([second.id])
  })

  it('validates names, dates, parents, exact cells, filters, and reorder membership', () => {
    const now = new Date('2026-08-09T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const otherFocus = database!.domain.focuses.create({ title: 'Other Focus' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    const current = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      now
    )
    const customerId = current.subjects[0].id
    const unrelatedScope = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Unrelated',
      dimension: 'subject'
    }, now)
    const otherScope = database!.domain.scopes.create({
      focusId: otherFocus.id,
      name: 'Other',
      dimension: 'subject'
    }, now)

    expect(() => database!.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: '   '
    })).toThrow('Todo name cannot be empty')
    expect(() => database!.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Invalid date',
      dueDate: '2026-02-30'
    })).toThrow('real calendar date')
    expect(() => database!.domain.todos.create({
      parent: { type: 'thread-scope', id: thread.id, scope: {
        scopeId: unrelatedScope.id,
        subjectId: customerId
      } },
      name: 'Wrong current Scope'
    }, now)).toThrow('current effective Scope')
    expect(() => database!.domain.todos.create({
      parent: { type: 'thread-scope', id: thread.id, scope: {
        scopeId: otherScope.id,
        subjectId: customerId
      } },
      name: 'Cross-Focus Scope'
    }, now)).toThrow('belong to its parent Focus')

    const valid = database!.domain.todos.create({
      parent: { type: 'thread-scope', id: thread.id, scope: {
        scopeId: current.scopeId as number,
        subjectId: customerId
      } },
      name: 'Valid scoped Todo'
    }, now)
    database!.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Focus-level Todo'
    }, now)
    expect(() => database!.domain.todos.reorder(
      { type: 'focus', id: focus.id },
      [valid.id]
    )).toThrow('not in this sort context')
    expect(() => database!.domain.todos.reorder(
      { type: 'thread', id: thread.id },
      [valid.id, valid.id]
    )).toThrow('must be unique')
    expect(() => database!.domain.todos.list(
      { type: 'thread', id: thread.id },
      { dueOnOrAfter: '2026-09-01', dueOnOrBefore: '2026-08-01' }
    )).toThrow('range is inverted')
  })

  it('keeps scoped Todos observable after the Thread context changes', () => {
    const now = new Date('2026-08-09T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    const original = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      now
    )
    const oldContext = {
      type: 'thread-scope' as const,
      id: thread.id,
      scope: { scopeId: original.scopeId as number, subjectId: original.subjects[0].id }
    }
    const todo = database!.domain.todos.create({
      parent: oldContext,
      name: 'Retained scoped work'
    }, now)

    database!.domain.threadScopes.removeSubject(thread.id, original.subjects[0].id, now)

    expect(database!.domain.todos.list(oldContext).map(({ id }) => id)).toEqual([todo.id])
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id }).map(({ id }) => id))
      .toEqual([todo.id])
    expect(() => database!.domain.todos.create({
      parent: oldContext,
      name: 'New work in former context'
    }, now)).toThrow('current effective Scope')
  })

  it('cascades Todo records and placements with their owner but retains shared Scope data', () => {
    const now = new Date('2026-08-09T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    const scoped = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      now
    )
    const todo = database!.domain.todos.create({
      parent: {
        type: 'thread-scope',
        id: thread.id,
        scope: { scopeId: scoped.scopeId as number, subjectId: scoped.subjects[0].id }
      },
      name: 'Review customer tickets'
    }, now)

    expect(thread.delete()).toBe(true)
    expect(database!.domain.todos.find(todo.id)).toBeNull()
    expect(database!.domain.scopes.find(scoped.scopeId as number)).not.toBeNull()
    expect(database!.domain.subjects.find(scoped.subjects[0].id)).not.toBeNull()

    database!.close()
    database = undefined
    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare('SELECT count(*) AS count FROM todo_sort_placements').get())
      .toMatchObject({ count: 0 })
    expect(raw.prepare('SELECT count(*) AS count FROM todo_lists').get())
      .toMatchObject({ count: 0 })
    raw.close()
  })
})
