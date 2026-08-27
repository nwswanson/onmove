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

  it('creates and edits aggregate Thread and Commitment Todos', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
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

  it('persists literal text-tag syntax unchanged across database reopen', () => {
    const focus = database!.domain.focuses.create({ title: 'Tagged work' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Tagged Thread',
      reviewFrequencyDays: 7
    })
    const todo = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Coordinate @Launch2 readiness'
    })

    database!.close()
    database = new AppDatabase(databasePath)

    expect(database.domain.todos.find(todo.id)).toMatchObject({
      name: 'Coordinate @Launch2 readiness'
    })
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
      type: 'tracking',
      title: 'Improve ticket quality'
    }, now)
    const aggregate = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Prepare aggregate report'
    }, now)
    const scoped = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      now
    )
    const cell = { scopeId: scoped.scopeId as number, subjectId: scoped.subjects[0].id }
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
    expect(first.toSnapshot().subject).toMatchObject({
      id: cell.subjectId,
      name: 'Customer Operations'
    })
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
    expect(database!.domain.todos.query().filter(({ id }) =>
      [aggregate.id, first.id, second.id, commitmentTodo.id].includes(id)
    ).map(({ id }) => id).sort((left, right) => left - right)).toEqual(
      [aggregate.id, first.id, second.id, commitmentTodo.id].sort((left, right) => left - right)
    )
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

  it('shares one Todo across current Subjects and derives closure through Scope changes', () => {
    const createdOn = new Date('2026-08-09T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, createdOn)
    database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      createdOn
    )
    const initialScope = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Platform Team' },
      createdOn
    )
    const customer = initialScope.subjects.find(({ name }) => name === 'Customer Operations')!
    const platform = initialScope.subjects.find(({ name }) => name === 'Platform Team')!
    const shared = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Confirm the rollout',
      sharedAcrossSubjects: true
    }, createdOn)

    expect(shared.toSnapshot()).toMatchObject({
      parent: { type: 'thread', id: thread.id },
      sharedAcrossSubjects: true,
      done: false,
      completedAt: null,
      subjectCompletions: [
        { subject: { id: customer.id }, done: false },
        { subject: { id: platform.id }, done: false }
      ]
    })
    expect(shared.sort).toHaveLength(3)
    for (const subject of [customer, platform]) {
      expect(database!.domain.todos.list({
        type: 'thread-scope',
        id: thread.id,
        scope: { scopeId: initialScope.scopeId!, subjectId: subject.id }
      }, {}, createdOn).map(({ id }) => id)).toContain(shared.id)
    }
    expect(() => shared.setDone(true)).toThrow(
      'completed only through its Subject completion cells'
    )

    const customerDoneOn = new Date('2026-08-10T09:00:00.000Z')
    shared.setSubjectDone(customer.id, true)
    expect(shared.toSnapshot()).toMatchObject({
      done: false,
      subjectCompletions: [
        { subject: { id: customer.id }, done: true },
        { subject: { id: platform.id }, done: false }
      ]
    })
    const completed = database!.domain.todos.updateSubjectCompletion(
      shared.id,
      platform.id,
      true,
      customerDoneOn
    )
    expect(completed).toMatchObject({
      done: true,
      completedAt: customerDoneOn.toISOString()
    })

    const changedOn = new Date('2026-08-11T12:00:00.000Z')
    database!.domain.threadScopes.removeSubject(thread.id, platform.id, changedOn)
    let reconciled = database!.domain.todos.list(
      { type: 'thread', id: thread.id },
      {},
      changedOn
    ).find(({ id }) => id === shared.id)!
    expect(reconciled.subjectCompletions.map(({ subject, done }) => ({
      subject: subject.name,
      done
    }))).toEqual([{ subject: 'Customer Operations', done: true }])
    expect(reconciled.done).toBe(true)

    const widenedOn = new Date('2026-08-12T12:00:00.000Z')
    const widened = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Partner Team' },
      widenedOn
    )
    const partner = widened.subjects.find(({ name }) => name === 'Partner Team')!
    reconciled = database!.domain.todos.list(
      { type: 'thread', id: thread.id },
      {},
      widenedOn
    ).find(({ id }) => id === shared.id)!
    expect(reconciled.done).toBe(false)
    expect(reconciled.completedAt).toBeNull()
    expect(reconciled.subjectCompletions).toMatchObject([
      { subject: { id: customer.id }, done: true },
      { subject: { id: partner.id }, done: false }
    ])

    const narrowedOn = new Date('2026-08-13T12:00:00.000Z')
    database!.domain.threadScopes.removeSubject(thread.id, partner.id, narrowedOn)
    reconciled = database!.domain.todos.list(
      { type: 'thread', id: thread.id },
      {},
      narrowedOn
    ).find(({ id }) => id === shared.id)!
    expect(reconciled).toMatchObject({
      done: true,
      completedAt: narrowedOn.toISOString()
    })
    expect(reconciled.subjectCompletions).toHaveLength(1)

    expect(database!.domain.todos.delete(shared.id)).toBe(true)
    const stored = new DatabaseSync(databasePath, { readOnly: true })
    expect(stored.prepare(
      'SELECT COUNT(*) AS count FROM todo_subject_completions WHERE todo_id = ?'
    ).get(shared.id)).toEqual({ count: 0 })
    stored.close()
  })

  it('reorders filtered subsets without moving hidden Todos out of their slots', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const context = { type: 'thread' as const, id: thread.id }
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
      parent: { type: 'thread', id: thread.id },
      name: '   '
    })).toThrow('Todo name cannot be empty')
    expect(() => database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
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
    expect(() => database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Unscoped Thread Todo'
    }, now)).toThrow('requires a Scope and Subject cell')

    const scopedCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Scoped commitment'
    }, now)
    expect(() => database!.domain.todos.create({
      parent: { type: 'commitment', id: scopedCommitment.id },
      name: 'Unscoped Commitment Todo'
    }, now)).toThrow('requires a Scope and Subject cell')

    const valid = database!.domain.todos.create({
      parent: { type: 'thread-scope', id: thread.id, scope: {
        scopeId: current.scopeId as number,
        subjectId: customerId
      } },
      name: 'Valid scoped Todo'
    }, now)
    const otherThread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Other Thread',
      reviewFrequencyDays: 7
    }, now)
    const otherTodo = database!.domain.todos.create({
      parent: { type: 'thread', id: otherThread.id },
      name: 'Other Thread Todo'
    }, now)
    expect(() => database!.domain.todos.reorder(
      { type: 'thread', id: thread.id },
      [otherTodo.id]
    )).toThrow('not in this sort context')
    expect(() => database!.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Retired Focus Todo'
    }, now)).toThrow(/must belong to a Thread or Commitment/)
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
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
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
    const commitmentTodo = database!.domain.todos.create({
      parent: {
        type: 'commitment-scope',
        id: commitment.id,
        scope: oldContext.scope
      },
      name: 'Retained scoped commitment work'
    }, now)

    database!.domain.threadScopes.removeSubject(thread.id, original.subjects[0].id, now)

    expect(database!.domain.todos.list(oldContext).map(({ id }) => id)).toEqual([todo.id])
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id }).map(({ id }) => id))
      .toEqual([todo.id])
    expect(() => database!.domain.todos.create({
      parent: oldContext,
      name: 'New work in former context'
    }, now)).toThrow('current effective Scope')
    expect(database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Thread fallback work'
    }, now).parent).toEqual({ type: 'thread', id: thread.id })
    expect(database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Commitment fallback work'
    }, now).parent).toEqual({ type: 'commitment', id: commitment.id })
    expect(database!.domain.todos.find(commitmentTodo.id)).toMatchObject({
      id: commitmentTodo.id,
      subject: { id: original.subjects[0].id, name: 'Customer Operations' }
    })
    expect(() => database!.domain.subjects.delete(original.subjects[0].id)).toThrow(
      'cannot be deleted'
    )
    expect(database!.domain.todos.find(todo.id)).toMatchObject({
      id: todo.id,
      subject: { id: original.subjects[0].id, name: 'Customer Operations' }
    })
  })

  it('queries due work once across all contexts and cascades each owner boundary', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
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
    const oversight = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Oversight',
      reviewFrequencyDays: 7
    })
    const focusTodo = database!.domain.todos.create({
      parent: { type: 'thread', id: oversight.id },
      name: 'Due oversight item',
      dueDate: '2026-08-08'
    })
    const threadTodo = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Later thread item',
      dueDate: '2026-08-12'
    })
    const commitmentTodo = database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Completed item',
      dueDate: '2026-08-07',
      done: true
    })

    expect(database!.domain.todos.query({
      done: false,
      dueOnOrBefore: '2026-08-09'
    }).map(({ id }) => id)).toEqual([focusTodo.id])
    expect(database!.domain.todos.query().map(({ id }) => id)).toEqual([
      focusTodo.id,
      threadTodo.id,
      commitmentTodo.id
    ])

    expect(commitment.delete()).toBe(true)
    expect(database!.domain.todos.find(commitmentTodo.id)).toBeNull()
    expect(thread.delete()).toBe(true)
    expect(database!.domain.todos.find(threadTodo.id)).toBeNull()
    expect(database!.domain.threads.delete(oversight.id)).toBe(true)
    expect(database!.domain.todos.find(focusTodo.id)).toBeNull()
    expect(focus.delete()).toBe(true)
    expect(database!.domain.todos.query()).toEqual([])
  })

  it('materializes a bounded global overview with hierarchy context and durable closure time', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const focus = database!.domain.focuses.create({
      title: 'Project Atlas',
      sensitive: true
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    }, now)
    const active = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Align sponsors',
      dueDate: '2026-08-09'
    }, now)
    const recent = database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Review examples',
      done: true
    }, new Date('2026-08-09T12:00:00.000Z'))
    const old = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Old closed work',
      done: true
    }, new Date('2026-07-31T12:00:00.000Z'))

    const overview = database!.domain.todos.overview(now)

    expect(overview).toMatchObject({
      today: '2026-08-10',
      recentlyCompletedDays: 7,
      completedSince: '2026-08-03T12:00:00.000Z'
    })
    expect(overview.items.map(({ id }) => id)).toEqual([active.id, recent.id])
    expect(overview.items.find(({ id }) => id === recent.id)).toMatchObject({
      completedAt: '2026-08-09T12:00:00.000Z',
      focus: { id: focus.id, title: 'Project Atlas', sensitive: true },
      thread: { id: thread.id, title: 'Sprint execution', sensitive: false },
      commitment: { id: commitment.id, title: 'Improve ticket quality', sensitive: false }
    })
    expect(overview.items.some(({ id }) => id === old.id)).toBe(false)

    const completed = database!.domain.todos.update(
      active.id,
      { done: true },
      new Date('2026-08-10T13:00:00.000Z')
    )
    expect(completed.completedAt).toBe('2026-08-10T13:00:00.000Z')
    const edited = database!.domain.todos.update(
      active.id,
      { name: 'Align executive sponsors' },
      new Date('2026-08-11T13:00:00.000Z')
    )
    expect(edited.completedAt).toBe('2026-08-10T13:00:00.000Z')
    expect(database!.domain.todos.update(
      active.id,
      { done: false },
      new Date('2026-08-12T13:00:00.000Z')
    ).completedAt).toBeNull()
    expect(() => database!.domain.todos.overview(now, 0)).toThrow(/positive integer/)
  })

  it('projects Todos only while their complete owner hierarchy is current', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
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
    const threadTodo = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Prepare sprint review'
    })
    const commitmentTodo = database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Draft examples'
    })

    const visibleIds = (): number[] => database!.domain.todos.overview().items
      .map(({ id }) => id)
    expect(visibleIds()).toEqual([threadTodo.id, commitmentTodo.id])

    commitment.setStatus('done')
    expect(database!.domain.todos.list({ type: 'commitment', id: commitment.id })).toEqual([])
    expect(database!.domain.todos.query().map(({ id }) => id)).toEqual([threadTodo.id])
    expect(visibleIds()).toEqual([threadTodo.id])
    expect(database!.domain.todos.find(commitmentTodo.id)?.done).toBe(false)
    expect(() => database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Invisible new work'
    })).toThrow(/active or paused Focus, Thread, and Commitment hierarchy/)

    commitment.setStatus('paused')
    expect(visibleIds()).toEqual([threadTodo.id, commitmentTodo.id])

    thread.setStatus('cancelled')
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id })).toEqual([])
    expect(database!.domain.todos.list({ type: 'commitment', id: commitment.id })).toEqual([])
    expect(database!.domain.todos.query()).toEqual([])
    expect(visibleIds()).toEqual([])
    expect(() => database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Invisible Thread work'
    })).toThrow(/active or paused Focus, Thread, and Commitment hierarchy/)

    thread.setStatus('paused')
    expect(visibleIds()).toEqual([threadTodo.id, commitmentTodo.id])

    focus.setStatus('done')
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id })).toEqual([])
    expect(database!.domain.todos.query()).toEqual([])
    expect(visibleIds()).toEqual([])
    expect(database!.domain.todos.find(threadTodo.id)).toMatchObject({
      id: threadTodo.id,
      done: false
    })

    focus.setStatus('paused')
    expect(visibleIds()).toEqual([threadTodo.id, commitmentTodo.id])
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
