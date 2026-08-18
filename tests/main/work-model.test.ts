import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { ModelNotFoundError, ModelValidationError } from '../../src/main/data/model'

describe('Thread, Commitment, and Update models', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-work-model-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates multiple top-level threads for a focus with derived review state', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const sprint = database!.domain.threads.create(
      { focusId: focus.id, title: 'Sprint execution', reviewFrequencyDays: 7 },
      new Date('2026-01-01T12:00:00.000Z')
    )
    database!.domain.threads.create(
      { focusId: focus.id, title: 'Team health', reviewFrequencyDays: 14 },
      new Date('2026-01-01T12:00:00.000Z')
    )

    expect(database!.domain.threads.listForFocus(focus.id, '2026-01-07')).toHaveLength(2)
    expect(sprint.snapshot('2026-01-07')).toMatchObject({
      focusId: focus.id,
      title: 'Sprint execution',
      health: 'none',
      status: 'active',
      reviewFrequencyDays: 7,
      lastReviewDate: null,
      nextReviewDate: '2026-01-08',
      needsReview: true,
      reviewDue: false
    })
    expect(sprint.snapshot('2026-01-08').reviewDue).toBe(true)
  })

  it('does not let active threads block closing their parent focus', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })

    focus.setStatus('done')

    expect(focus.status).toBe('done')
    expect(database!.domain.threads.requireModel(thread.id).status).toBe('active')
  })

  it('persists, edits, clears, and validates an optional Thread due date', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7,
      dueDate: '2026-09-15'
    })

    expect(thread.snapshot().dueDate).toBe('2026-09-15')
    thread.update({ dueDate: '2026-10-01' })
    expect(thread.snapshot().dueDate).toBe('2026-10-01')
    thread.update({ dueDate: null })
    expect(thread.snapshot().dueDate).toBeNull()
    expect(() => thread.update({ dueDate: '2026-02-30' })).toThrow(ModelValidationError)
  })

  it('parents generic tracking Commitments to exactly one Thread', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const dueDated = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality',
      dueDate: '2026-02-15'
    })
    const oversight = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Stakeholder oversight',
      reviewFrequencyDays: 7
    })
    const undated = database!.domain.commitments.create({
      parent: { type: 'thread', id: oversight.id },
      type: 'tracking',
      title: 'Weekly stakeholder alignment',
      cadenceDays: 7
    })

    expect(dueDated.snapshot('2026-02-01')).toMatchObject({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      dueDate: '2026-02-15',
      state: 'none'
    })
    expect(undated.snapshot('2026-02-01')).toMatchObject({
      parent: { type: 'thread', id: oversight.id },
      type: 'tracking',
      cadenceDays: 7
    })
    expect(database!.domain.commitments.listForThread(thread.id)).toHaveLength(1)
    expect(database!.domain.commitments.listForThread(oversight.id)).toHaveLength(1)
    expect(database!.domain.commitments.listForFocus(focus.id)).toEqual([])
  })

  it('keeps generic type stable while isolating the legacy due-date compatibility value', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Launch delivery',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Publish the launch plan'
    })

    const dueDated = database!.domain.commitments.update(commitment.id, {
      dueDate: '2026-09-15'
    })
    expect(dueDated).toMatchObject({
      dueDate: '2026-09-15',
      type: 'tracking'
    })
    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare(
      'SELECT commitment_type, legacy_due_type FROM commitments WHERE id = ?'
    ).get(commitment.id)).toMatchObject({
      commitment_type: 'tracking',
      legacy_due_type: 'action'
    })

    const undated = database!.domain.commitments.update(commitment.id, {
      dueDate: null
    })
    expect(undated).toMatchObject({
      dueDate: null,
      type: 'tracking'
    })
    expect(raw.prepare(
      'SELECT commitment_type, legacy_due_type FROM commitments WHERE id = ?'
    ).get(commitment.id)).toMatchObject({
      commitment_type: 'tracking',
      legacy_due_type: 'ongoing'
    })
    raw.close()
  })

  it('moves a Commitment subtree between compatible inherited Threads without scope mutation', () => {
    const focus = database!.domain.focuses.create({ title: 'Delivery' })
    const focusScope = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Customer Operations' }
    )
    const source = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Alpha',
      reviewFrequencyDays: 7
    })
    const target = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Beta',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: source.id },
      type: 'tracking',
      title: 'Keep the rollout healthy'
    })

    const plan = commitment.movePlan({ type: 'thread', id: target.id })
    expect(plan).toMatchObject({
      from: { type: 'thread', id: source.id },
      to: { type: 'thread', id: target.id },
      sourceScopeMode: 'inherited',
      sourceScopeId: focusScope.scopeId,
      targetScopeId: focusScope.scopeId,
      scopeSubjectAdditions: [],
      ownedRecords: { updates: 0, todos: 0, notes: 1 },
      requiresConfirmation: false
    })

    commitment.moveTo({ parent: { type: 'thread', id: target.id } })

    expect(commitment.snapshot().parent).toEqual({ type: 'thread', id: target.id })
    expect(commitment.scopeApplication()).toMatchObject({
      mode: 'inherited',
      effectiveScopeId: focusScope.scopeId,
      inheritedFrom: { type: 'thread', id: target.id }
    })
    expect(commitment.parentHistory().map(({ from, to }) => ({ from, to }))).toEqual([
      { from: null, to: { type: 'thread', id: source.id } },
      {
        from: { type: 'thread', id: source.id },
        to: { type: 'thread', id: target.id }
      }
    ])
  })

  it('moves an inherited Thread subtree across compatible Focuses without losing child identity', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const sourceFocus = database!.domain.focuses.create({ title: 'Source portfolio' })
    const targetFocus = database!.domain.focuses.create({ title: 'Target portfolio' })
    const sourceFocusScope = database!.domain.focusScopes.addSubject(
      sourceFocus.id,
      { name: 'Customer Operations' },
      now
    )
    const targetFocusScope = database!.domain.focusScopes.addSubject(
      targetFocus.id,
      { name: 'Customer Operations' },
      now
    )
    const subject = sourceFocusScope.subjects[0]
    const thread = database!.domain.threads.create({
      focusId: sourceFocus.id,
      title: 'Regional rollout',
      reviewFrequencyDays: 7
    }, now)
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Keep ticket quality high'
    }, now)
    const directUpdate = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-10',
      observation: 'Thread evidence',
      state: 'green',
      scope: { scopeId: sourceFocusScope.scopeId!, subjectId: subject.id }
    }, now).toSnapshot()
    const commitmentUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-08-10',
      observation: 'Commitment evidence',
      state: 'yellow',
      scope: { scopeId: sourceFocusScope.scopeId!, subjectId: subject.id }
    }, now).toSnapshot()
    const directTodo = database!.domain.todos.create({
      parent: {
        type: 'thread-scope',
        id: thread.id,
        scope: { scopeId: sourceFocusScope.scopeId!, subjectId: subject.id }
      },
      name: 'Thread action'
    }, now).toSnapshot()
    const commitmentTodo = database!.domain.todos.create({
      parent: {
        type: 'commitment-scope',
        id: commitment.id,
        scope: { scopeId: sourceFocusScope.scopeId!, subjectId: subject.id }
      },
      name: 'Commitment action'
    }, now).toSnapshot()
    const reviewCell = { scopeId: sourceFocusScope.scopeId!, subjectId: subject.id }
    thread.pokeReview(new Date('2026-08-11T12:00:00.000Z'), reviewCell)
    commitment.pokeReview(new Date('2026-08-11T12:00:00.000Z'), reviewCell)

    const plan = thread.movePlan(targetFocus.id)
    expect(plan).toMatchObject({
      fromFocusId: sourceFocus.id,
      toFocusId: targetFocus.id,
      sourceScopeMode: 'inherited',
      sourceScopeId: sourceFocusScope.scopeId,
      targetScopeId: targetFocusScope.scopeId,
      scopeStrategy: 'follow-destination',
      scopeSubjectAdditions: [],
      ownedRecords: { commitments: 1, updates: 2, todos: 2, notes: 2 },
      requiresConfirmation: false
    })

    thread.moveTo({
      focusId: targetFocus.id,
      plannedFromFocusId: sourceFocus.id
    })

    expect(thread.snapshot()).toMatchObject({ focusId: targetFocus.id, title: 'Regional rollout' })
    expect(thread.scopeApplication()).toMatchObject({
      mode: 'inherited',
      effectiveScopeId: targetFocusScope.scopeId,
      inheritedFrom: { type: 'focus', id: targetFocus.id }
    })
    expect(thread.parentHistory().map(({ fromFocusId, toFocusId }) => ({
      fromFocusId,
      toFocusId
    }))).toEqual([
      { fromFocusId: null, toFocusId: sourceFocus.id },
      { fromFocusId: sourceFocus.id, toFocusId: targetFocus.id }
    ])
    expect(database!.domain.commitments.listForThread(thread.id).map(({ id }) => id))
      .toEqual([commitment.id])
    const movedUpdates = [
      ...database!.domain.updates.listForThread(thread.id),
      ...database!.domain.updates.listForCommitment(commitment.id)
    ]
    expect(movedUpdates.map(({ id }) => id).sort()).toEqual(
      [directUpdate.id, commitmentUpdate.id].sort()
    )
    expect(new Set(movedUpdates.map(({ scope }) => scope?.scopeId))).not.toContain(
      sourceFocusScope.scopeId
    )
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id })
      .map(({ id }) => id)).toContain(directTodo.id)
    expect(database!.domain.todos.list({ type: 'commitment', id: commitment.id })
      .map(({ id }) => id)).toContain(commitmentTodo.id)
    const movedReviewPokes = database!.dataArchive.export('test').tables
    expect(movedReviewPokes.thread_review_cell_pokes).toMatchObject([
      { thread_id: thread.id, subject_id: subject.id }
    ])
    expect(movedReviewPokes.commitment_review_cell_pokes).toMatchObject([
      { commitment_id: commitment.id, subject_id: subject.id }
    ])
    expect(movedReviewPokes.thread_review_cell_pokes[0].scope_id)
      .not.toBe(sourceFocusScope.scopeId)
    expect(movedReviewPokes.commitment_review_cell_pokes[0].scope_id)
      .not.toBe(sourceFocusScope.scopeId)

    expect(sourceFocus.delete()).toBe(true)
    expect(thread.snapshot().focusId).toBe(targetFocus.id)
    expect(database!.domain.commitments.find(commitment.id)).not.toBeNull()
  })

  it('requires an exact stale-safe confirmation before widening a destination Focus', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const sourceFocus = database!.domain.focuses.create({ title: 'Source portfolio' })
    const targetFocus = database!.domain.focuses.create({ title: 'Target portfolio' })
    database!.domain.focusScopes.addSubject(sourceFocus.id, { name: 'Core Team' }, now)
    const sourceScope = database!.domain.focusScopes.addSubject(
      sourceFocus.id,
      { name: 'Partner Team' },
      now
    )
    database!.domain.focusScopes.addSubject(targetFocus.id, { name: 'Core Team' }, now)
    const partner = sourceScope.subjects.find(({ name }) => name === 'Partner Team')!
    const thread = database!.domain.threads.create({
      focusId: sourceFocus.id,
      title: 'Partner readiness',
      reviewFrequencyDays: 7
    }, now)

    expect(thread.movePlan(targetFocus.id)).toMatchObject({
      scopeSubjectAdditions: [{ id: partner.id, name: 'Partner Team' }],
      requiresConfirmation: true
    })
    expect(() => thread.moveTo({
      focusId: targetFocus.id,
      plannedFromFocusId: sourceFocus.id
    })).toThrow('must be planned and explicitly confirmed')
    expect(() => thread.moveTo({
      focusId: targetFocus.id,
      plannedFromFocusId: sourceFocus.id,
      confirmedScopeSubjectIds: [999]
    })).toThrow('must be planned and explicitly confirmed')
    expect(() => thread.moveTo({
      focusId: targetFocus.id,
      plannedFromFocusId: targetFocus.id,
      confirmedScopeSubjectIds: [partner.id]
    })).toThrow('plan is stale')
    expect(thread.snapshot().focusId).toBe(sourceFocus.id)

    thread.moveTo({
      focusId: targetFocus.id,
      plannedFromFocusId: sourceFocus.id,
      confirmedScopeSubjectIds: [partner.id]
    })
    expect(database!.domain.focusScopes.get(targetFocus.id).subjects.map(({ name }) => name).sort())
      .toEqual(['Core Team', 'Partner Team'])
    expect(thread.snapshot().focusId).toBe(targetFocus.id)
  })

  it('rolls back a stale move target and cascades only from the new owning Focus', () => {
    const sourceFocus = database!.domain.focuses.create({ title: 'Source portfolio' })
    const deletedTarget = database!.domain.focuses.create({ title: 'Deleted target' })
    const thread = database!.domain.threads.create({
      focusId: sourceFocus.id,
      title: 'Move safely',
      reviewFrequencyDays: 7
    })
    const child = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Keep child identity'
    })

    expect(thread.movePlan(deletedTarget.id).requiresConfirmation).toBe(false)
    deletedTarget.delete()
    expect(() => thread.moveTo({
      focusId: deletedTarget.id,
      plannedFromFocusId: sourceFocus.id
    })).toThrow(ModelNotFoundError)
    expect(thread.snapshot().focusId).toBe(sourceFocus.id)

    const survivingTarget = database!.domain.focuses.create({ title: 'Surviving target' })
    thread.moveTo({
      focusId: survivingTarget.id,
      plannedFromFocusId: sourceFocus.id
    })
    expect(sourceFocus.delete()).toBe(true)
    expect(database!.domain.threads.find(thread.id)).not.toBeNull()
    expect(database!.domain.commitments.find(child.id)).not.toBeNull()

    expect(survivingTarget.delete()).toBe(true)
    expect(database!.domain.threads.find(thread.id)).toBeNull()
    expect(database!.domain.commitments.find(child.id)).toBeNull()
    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare('SELECT count(*) AS count FROM thread_move_operations').get())
      .toEqual({ count: 0 })
    expect(raw.prepare('SELECT count(*) AS count FROM thread_parent_transitions').get())
      .toEqual({ count: 0 })
    raw.close()
  })

  it('copies a custom Thread Scope graph and reconciles shared Todos in the destination', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const sourceFocus = database!.domain.focuses.create({ title: 'Source portfolio' })
    const targetFocus = database!.domain.focuses.create({ title: 'Target portfolio' })
    database!.domain.focusScopes.addSubject(sourceFocus.id, { name: 'Core Team' }, now)
    const thread = database!.domain.threads.create({
      focusId: sourceFocus.id,
      title: 'Custom regional lens',
      reviewFrequencyDays: 7
    }, now)
    const custom = database!.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Partner Team' },
      now
    )
    const partner = custom.subjects.find(({ name }) => name === 'Partner Team')!
    const update = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-10',
      observation: 'Custom evidence',
      state: 'green',
      scope: { scopeId: custom.scopeId!, subjectId: partner.id }
    }, now).toSnapshot()
    const individual = database!.domain.todos.create({
      parent: {
        type: 'thread-scope',
        id: thread.id,
        scope: { scopeId: custom.scopeId!, subjectId: partner.id }
      },
      name: 'Partner-specific action'
    }, now).toSnapshot()
    const shared = database!.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Shared readiness action',
      sharedAcrossSubjects: true
    }, now).toSnapshot()

    expect(thread.movePlan(targetFocus.id)).toMatchObject({
      scopeStrategy: 'copy-custom',
      scopeSubjectAdditions: [],
      requiresConfirmation: false
    })
    thread.moveTo({
      focusId: targetFocus.id,
      plannedFromFocusId: sourceFocus.id
    })

    const movedScope = database!.domain.threadScopes.get(thread.id)
    expect(movedScope).toMatchObject({
      focusId: targetFocus.id,
      mode: 'explicit',
      subjects: expect.arrayContaining([
        expect.objectContaining({ name: 'Core Team' }),
        expect.objectContaining({ name: 'Partner Team' })
      ])
    })
    expect(movedScope.scopeId).not.toBe(custom.scopeId)
    expect(database!.domain.focusScopes.get(targetFocus.id)).toMatchObject({
      mode: 'open',
      subjects: []
    })
    expect(database!.domain.updates.listForThread(thread.id)).toMatchObject([
      { id: update.id, scope: { scopeId: movedScope.scopeId, subjectId: partner.id } }
    ])
    expect(database!.domain.todos.list({ type: 'thread', id: thread.id }, {}, now)
      .map(({ id }) => id)).toEqual(expect.arrayContaining([individual.id, shared.id]))
    const movedIndividual = database!.domain.todos.find(individual.id, now)!
    expect(movedIndividual.parent).toMatchObject({
      type: 'thread-scope',
      scope: { scopeId: movedScope.scopeId, subjectId: partner.id }
    })
    const movedShared = database!.domain.todos.find(shared.id, now)!
    expect(movedShared.subjectCompletions).toHaveLength(2)
    expect(movedShared.sort).toHaveLength(3)
  })

  it('plans and atomically confirms custom Subject widening while retaining child evidence', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Delivery' })
    const source = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Custom source',
      reviewFrequencyDays: 7
    })
    const target = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Open target',
      reviewFrequencyDays: 7
    })
    const sourceScope = database!.domain.threadScopes.addSubject(
      source.id,
      { name: 'Platform Team' },
      now
    )
    const subject = sourceScope.subjects[0]
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: source.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })
    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-08-10',
      observation: '',
      state: 'red',
      scope: { scopeId: sourceScope.scopeId!, subjectId: subject.id }
    }).toSnapshot()
    const todo = database!.domain.todos.create({
      parent: {
        type: 'commitment-scope',
        id: commitment.id,
        scope: { scopeId: sourceScope.scopeId!, subjectId: subject.id }
      },
      name: 'Refine acceptance criteria'
    }).toSnapshot()
    const note = commitment.snapshot().notes[0]
    database!.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      'Keep this durable context'
    )

    const plan = commitment.movePlan({ type: 'thread', id: target.id })
    expect(plan).toMatchObject({
      sourceScopeMode: 'explicit',
      sourceScopeId: sourceScope.scopeId,
      targetScopeId: null,
      scopeSubjectAdditions: [{ id: subject.id, name: 'Platform Team' }],
      ownedRecords: { updates: 1, todos: 1, notes: 1 },
      requiresConfirmation: true
    })
    expect(() => commitment.moveTo({ parent: { type: 'thread', id: target.id } }))
      .toThrow('must be planned and explicitly confirmed')
    expect(() => commitment.moveTo({
      parent: { type: 'thread', id: target.id },
      confirmedScopeSubjectIds: [999]
    })).toThrow('must be planned and explicitly confirmed')
    expect(commitment.snapshot().parent).toEqual({ type: 'thread', id: source.id })

    commitment.moveTo({
      parent: { type: 'thread', id: target.id },
      confirmedScopeSubjectIds: [subject.id]
    })

    const targetScope = database!.domain.threadScopes.get(target.id)
    expect(targetScope).toMatchObject({
      mode: 'explicit',
      subjects: [{ id: subject.id, name: 'Platform Team' }]
    })
    expect(commitment.snapshot().parent).toEqual({ type: 'thread', id: target.id })
    expect(commitment.scopeMatrix()).toMatchObject([{ subjectId: subject.id, state: 'none' }])
    expect(database!.domain.updates.listForCommitment(commitment.id)).toMatchObject([
      { id: update.id, scope: update.scope, observation: '', state: 'red' }
    ])
    expect(database!.domain.todos.list({ type: 'commitment', id: commitment.id }))
      .toMatchObject([{ id: todo.id, parent: todo.parent }])
    expect(database!.domain.notes.list({ type: 'commitment', id: commitment.id }))
      .toMatchObject([{ id: note.id, content: 'Keep this durable context' }])
  })

  it('rejects moving a Commitment from a Thread to Focus Overall', () => {
    const focus = database!.domain.focuses.create({ title: 'Delivery' })
    database!.domain.focusScopes.addSubject(focus.id, { name: 'Core Team' })
    const source = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Custom source',
      reviewFrequencyDays: 7
    })
    const sourceScope = database!.domain.threadScopes.addSubject(
      source.id,
      { name: 'Partner Team' }
    )
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: source.id },
      type: 'tracking',
      title: 'Partner readiness'
    })

    expect(sourceScope.subjects.map(({ name }) => name)).toContain('Partner Team')
    expect(() => commitment.movePlan({ type: 'focus', id: focus.id }))
      .toThrow(/must belong to a Thread/)
    expect(commitment.snapshot().parent).toEqual({ type: 'thread', id: source.id })
  })

  it('allows dated updates on threads and commitments with today as the default', () => {
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

    const currentUpdate = database!.domain.updates.create(
      { parent: { type: 'thread', id: thread.id }, observation: 'Project started', state: 'green' },
      new Date('2026-03-12T12:00:00.000Z')
    )
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2025-12-01',
      observation: 'Backdated baseline',
      state: 'yellow'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2027-01-01',
      observation: 'Forward plan',
      state: 'none'
    })

    expect(currentUpdate.toSnapshot()).toMatchObject({
      parent: { type: 'thread', id: thread.id },
      date: '2026-03-12',
      state: 'green'
    })
    expect(database!.domain.updates.listForThread(thread.id)[0].date).toBe('2025-12-01')
    expect(database!.domain.updates.listForCommitment(commitment.id)[0].date).toBe('2027-01-01')
  })

  it('edits and deletes persisted updates without changing their parent', () => {
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
    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Ticket quality is uneven',
      state: 'yellow'
    })

    update.update({
      date: '2026-01-11',
      observation: 'Acceptance criteria are now consistent',
      state: 'green'
    })

    expect(update.toSnapshot()).toMatchObject({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-11',
      observation: 'Acceptance criteria are now consistent',
      state: 'green'
    })
    expect(commitment.snapshot('2026-01-11').state).toBe('green')
    expect(update.delete()).toBe(true)
    expect(database!.domain.updates.listForCommitment(commitment.id)).toEqual([])
    expect(() => update.update({ state: 'red' })).toThrow('has been deleted')
  })

  it('deletes Commitments and cascades Thread deletion through owned work', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const nestedCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })
    const nestedUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: nestedCommitment.id },
      observation: 'Acceptance criteria are uneven',
      state: 'yellow'
    })
    const directUpdate = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Sprint execution is unstable',
      state: 'red'
    })
    const oversight = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Stakeholder oversight',
      reviewFrequencyDays: 7
    })
    const focusCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: oversight.id },
      type: 'tracking',
      title: 'Align sponsors'
    })
    const focusCommitmentUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: focusCommitment.id },
      observation: 'Sponsors are aligned',
      state: 'green'
    })

    expect(database!.domain.commitments.delete(focusCommitment.id)).toBe(true)
    expect(database!.domain.commitments.findModel(focusCommitment.id)).toBeNull()
    expect(database!.domain.updates.findModel(focusCommitmentUpdate.id)).toBeNull()

    expect(database!.domain.threads.delete(thread.id)).toBe(true)
    expect(database!.domain.threads.findModel(thread.id)).toBeNull()
    expect(database!.domain.commitments.findModel(nestedCommitment.id)).toBeNull()
    expect(database!.domain.updates.findModel(nestedUpdate.id)).toBeNull()
    expect(database!.domain.updates.findModel(directUpdate.id)).toBeNull()
    expect(database!.domain.threads.delete(thread.id)).toBe(false)
  })

  it('derives thread health from the latest direct update and active commitment states', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-01',
      observation: 'Sprint is healthy',
      state: 'green'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('green')

    const quality = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('none')
    database!.domain.updates.create({
      parent: { type: 'commitment', id: quality.id },
      date: '2026-01-01',
      observation: 'Acceptance criteria are now consistent',
      state: 'green'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('green')

    const refinement = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Weekly refinement'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: refinement.id },
      date: '2026-01-01',
      observation: 'Several tickets still need work',
      state: 'yellow'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('yellow')

    const blocker = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Remove test environment blocker'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: blocker.id },
      date: '2026-01-01',
      observation: 'Environment is unavailable',
      state: 'red'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('red')

    blocker.setStatus('paused')
    expect(thread.snapshot('2026-01-01').health).toBe('yellow')
    refinement.setStatus('done')
    expect(thread.snapshot('2026-01-01').health).toBe('green')
  })

  it('uses the highest recorded date and then insertion order for the latest commitment update', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Clarity',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Maintain project clarity'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Clarity improved',
      state: 'green'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-05',
      observation: 'Earlier ambiguity',
      state: 'red'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Newest same-day observation',
      state: 'yellow'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2027-01-01',
      observation: 'Future observation',
      state: 'red'
    })

    expect(commitment.snapshot('2026-01-06')).toMatchObject({
      state: 'red',
      lastUpdateDate: '2027-01-01'
    })
    expect(commitment.snapshot('2026-01-10')).toMatchObject({
      state: 'red',
      lastUpdateDate: '2027-01-01'
    })
    expect(commitment.snapshot('2026-12-31').state).toBe('red')
    expect(commitment.snapshot('2027-01-01').state).toBe('red')
  })

  it('includes a future-dated commitment update in its parent Thread health', () => {
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
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2099-12-31',
      observation: 'Deferred assessment',
      state: 'red'
    })

    expect(commitment.snapshot('2026-01-01')).toMatchObject({
      state: 'red',
      lastUpdateDate: '2099-12-31'
    })
    expect(thread.snapshot('2026-01-01').health).toBe('red')
  })

  it('changes last review only when a direct thread update is recorded', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create(
      { focusId: focus.id, title: 'Sprint execution', reviewFrequencyDays: 7 },
      new Date('2026-01-01T12:00:00.000Z')
    )
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-03',
      observation: 'Tickets reviewed',
      state: 'green'
    })

    expect(thread.snapshot('2026-01-09')).toMatchObject({
      lastReviewDate: null,
      nextReviewDate: '2026-01-08',
      needsReview: true,
      reviewDue: true
    })
    thread.snapshot('2026-01-09')
    expect(thread.snapshot('2026-01-09').lastReviewDate).toBeNull()

    const directReview = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-03',
      observation: 'Sprint review completed',
      state: 'green'
    })
    expect(thread.snapshot('2026-01-09')).toMatchObject({
      lastReviewDate: '2026-01-03',
      nextReviewDate: '2026-01-10',
      needsReview: true,
      reviewDue: false
    })
    expect(thread.snapshot('2026-01-10').reviewDue).toBe(true)

    thread.update({ needsReview: false })
    expect(thread.snapshot('2026-01-10')).toMatchObject({
      needsReview: false,
      reviewDue: false,
      lastReviewDate: '2026-01-03'
    })

    const laterReview = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-05',
      observation: 'A later direct review'
    })
    expect(thread.snapshot('2026-01-10').lastReviewDate).toBe('2026-01-05')
    laterReview.update({ date: '2026-01-02' })
    expect(thread.snapshot('2026-01-10').lastReviewDate).toBe('2026-01-03')
    directReview.delete()
    expect(thread.snapshot('2026-01-10').lastReviewDate).toBe('2026-01-02')
  })

  it('projects a Commitment review schedule independently from update cadence', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Long-range planning',
      reviewFrequencyDays: 30,
      needsReview: false
    }, new Date('2026-01-01T12:00:00.000Z'))
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Watch near-term risk',
      cadenceDays: 14,
      reviewFrequencyDays: 3
    }, new Date('2026-01-01T12:00:00.000Z'))

    commitment.pokeReview(new Date('2026-01-01T12:00:00.000Z'))
    expect(commitment.snapshot('2026-01-03')).toMatchObject({
      cadenceDays: 14,
      reviewFrequencyDays: 3,
      lastReviewDate: '2026-01-01',
      nextReviewDate: '2026-01-04',
      needsReview: true,
      reviewDue: false,
      nextUpdateDate: '2026-01-15',
      needsUpdate: false
    })
    expect(commitment.snapshot('2026-01-04').reviewDue).toBe(true)

    commitment.update({ reviewFrequencyDays: 10 })
    expect(commitment.snapshot('2026-01-04')).toMatchObject({
      reviewFrequencyDays: 10,
      nextReviewDate: '2026-01-11',
      reviewDue: false
    })
    commitment.update({ needsReview: false })
    expect(commitment.snapshot('2026-01-12')).toMatchObject({
      needsReview: false,
      reviewDue: false
    })
  })

  it('pokes Thread and Commitment reviews without fabricating Update evidence', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create(
      { focusId: focus.id, title: 'Sprint execution', reviewFrequencyDays: 7 },
      new Date('2026-01-01T12:00:00.000Z')
    )
    const commitment = database!.domain.commitments.create(
      {
        parent: { type: 'thread', id: thread.id },
        type: 'tracking',
        title: 'Improve ticket quality',
        cadenceDays: 7
      },
      new Date('2026-01-01T12:00:00.000Z')
    )
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-03',
      state: 'green'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-04',
      state: 'red'
    })

    thread.pokeReview(new Date('2026-01-06T12:00:00.000Z'))
    commitment.pokeReview(new Date('2026-01-06T12:00:00.000Z'))

    expect(thread.snapshot('2026-01-05')).toMatchObject({
      lastReviewDate: '2026-01-03',
      nextReviewDate: '2026-01-10'
    })
    expect(thread.snapshot('2026-01-10')).toMatchObject({
      lastReviewDate: '2026-01-06',
      nextReviewDate: '2026-01-13',
      reviewDue: false
    })
    expect(commitment.snapshot('2026-01-10')).toMatchObject({
      state: 'red',
      lastReviewDate: '2026-01-06',
      lastUpdateDate: '2026-01-04',
      nextUpdateDate: '2026-01-11',
      needsUpdate: false
    })
    expect(database!.domain.updates.listForThread(thread.id)).toHaveLength(1)
    expect(database!.domain.updates.listForCommitment(commitment.id)).toHaveLength(1)

    commitment.pokeReview(new Date('2026-01-02T12:00:00.000Z'))
    expect(commitment.snapshot('2026-01-10').lastReviewDate).toBe('2026-01-06')
    const laterUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-09',
      state: 'green'
    })
    expect(commitment.snapshot('2026-01-10')).toMatchObject({
      state: 'green',
      lastReviewDate: '2026-01-09',
      lastUpdateDate: '2026-01-09'
    })
    laterUpdate.delete()
    expect(commitment.snapshot('2026-01-10')).toMatchObject({
      state: 'red',
      lastReviewDate: '2026-01-06',
      lastUpdateDate: '2026-01-04'
    })
  })

  it('derives cadence deadlines from the highest-dated commitment update', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Refinement',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create(
      {
        parent: { type: 'thread', id: thread.id },
        type: 'tracking',
        title: 'Weekly refinement',
        cadenceDays: 7
      },
      new Date('2026-01-01T12:00:00.000Z')
    )

    expect(commitment.snapshot('2026-01-07')).toMatchObject({
      lastUpdateDate: null,
      nextUpdateDate: '2026-01-08',
      needsUpdate: false
    })
    expect(commitment.snapshot('2026-01-08').needsUpdate).toBe(true)

    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-08',
      observation: 'Refinement completed',
      state: 'green'
    })
    expect(commitment.snapshot('2026-01-14')).toMatchObject({
      nextUpdateDate: '2026-01-15',
      needsUpdate: false
    })
    expect(commitment.snapshot('2026-01-15').needsUpdate).toBe(true)

    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2099-12-31',
      observation: 'Intentionally defer the next update',
      state: 'yellow'
    })
    expect(commitment.snapshot('2026-01-15')).toMatchObject({
      state: 'yellow',
      lastUpdateDate: '2099-12-31',
      nextUpdateDate: '2100-01-07',
      needsUpdate: false
    })

    commitment.setStatus('paused')
    expect(commitment.snapshot('2026-01-15').needsUpdate).toBe(false)
  })

  it('audits thread and commitment lifecycle transitions without duplicate events', () => {
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

    thread.setStatus('paused').setStatus('active').setStatus('active')
    commitment.setStatus('done').setStatus('done')

    expect(thread.statusHistory()).toMatchObject([
      { from: null, to: 'active' },
      { from: 'active', to: 'paused' },
      { from: 'paused', to: 'active' }
    ])
    expect(commitment.statusHistory()).toMatchObject([
      { from: null, to: 'active' },
      { from: 'active', to: 'done' }
    ])
  })

  it('validates parents, dates, required text, cadence, frequency, and enums', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Validation Thread',
      reviewFrequencyDays: 7
    })
    expect(() =>
      database!.domain.threads.create({
        focusId: 999,
        title: 'Missing focus',
        reviewFrequencyDays: 7
      })
    ).toThrow(ModelNotFoundError)
    expect(() =>
      database!.domain.threads.create({
        focusId: focus.id,
        title: 'Bad frequency',
        reviewFrequencyDays: 0
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.threads.create({
        focusId: focus.id,
        title: 'Bad review flag',
        reviewFrequencyDays: 7,
        needsReview: 'yes' as never
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'focus', id: focus.id },
        type: 'tracking',
        title: 'Invalid Focus parent'
      })
    ).toThrow(/must belong to a Thread/)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'thread', id: thread.id },
        type: 'tracking',
        title: 'Bad cadence',
        cadenceDays: -1
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'thread', id: thread.id },
        type: 'future-type' as never,
        title: 'Unknown behavior family'
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'thread', id: thread.id },
        type: 'tracking',
        title: 'Bad review frequency',
        reviewFrequencyDays: 0
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'thread', id: thread.id },
        type: 'tracking',
        title: 'Bad review flag',
        needsReview: 'yes' as never
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.commitments.create({
        parent: { type: 'thread', id: thread.id },
        type: 'tracking',
        title: 'Bad date',
        dueDate: '2026-02-30'
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.updates.create({
        parent: { type: 'thread', id: thread.id },
        date: 'tomorrow',
        observation: 'Invalid date'
      })
    ).toThrow(ModelValidationError)
    expect(() =>
      database!.domain.updates.create({
        parent: { type: 'commitment', id: 999 },
        observation: 'Missing parent'
      })
    ).toThrow(ModelNotFoundError)
    expect(() =>
      database!.domain.updates.create({
        parent: { type: 'thread', id: thread.id },
        observation: 'Bad state',
        state: 'blue' as never
      })
    ).toThrow(ModelValidationError)
  })

  it('persists a state-only update and materializes it on its Commitment', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sponsor alignment',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Keep sponsors aligned'
    })

    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-08-07',
      state: 'red'
    })

    expect(update.toSnapshot()).toMatchObject({ observation: '', state: 'red' })
    expect(database!.domain.commitments.listForThread(thread.id, '2026-08-07')[0]).toMatchObject({
      id: commitment.id,
      state: 'red',
      lastUpdateDate: '2026-08-07'
    })
  })

  it('enforces exactly one parent at the SQLite layer', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA foreign_keys = ON')

    expect(() =>
      raw
        .prepare(
          `INSERT INTO commitments (
             focus_id, thread_id, commitment_type, title, status, created_at, updated_at
           ) VALUES (?, ?, 'tracking', 'Invalid', 'active', ?, ?)`
        )
        .run(focus.id, thread.id, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    ).toThrow()
    expect(() =>
      raw
        .prepare(
          `INSERT INTO updates (
             focus_id, thread_id, recorded_on, observation, state, created_at
           ) VALUES (?, ?, '2026-01-01', 'Invalid', 'none', ?)`
        )
        .run(focus.id, thread.id, '2026-01-01T00:00:00.000Z')
    ).toThrow()
    raw.close()
  })

  it('cascades child records and histories only when their owning parent is deleted', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const threadCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })
    const siblingThread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Stakeholder alignment',
      reviewFrequencyDays: 7
    })
    const focusCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: siblingThread.id },
      type: 'tracking',
      title: 'Stakeholder alignment'
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Thread update'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: threadCommitment.id },
      observation: 'Commitment update'
    })

    thread.delete()
    expect(database!.domain.commitments.find(threadCommitment.id)).toBeNull()
    expect(database!.domain.commitments.find(focusCommitment.id)).not.toBeNull()

    focus.delete()
    expect(database!.domain.commitments.find(focusCommitment.id)).toBeNull()
    const raw = new DatabaseSync(databasePath)
    for (const table of [
      'threads',
      'commitments',
      'updates',
      'thread_status_transitions',
      'commitment_status_transitions',
      'scope_application_transitions'
    ]) {
      const row = raw.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }
      expect(Number(row.count)).toBe(0)
    }
    raw.close()
  })

  it('retains the complete derived model after reopening SQLite', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality',
      cadenceDays: 7
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-01',
      observation: 'Sprint review is green',
      state: 'green'
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-01',
      observation: 'Ticket quality improved',
      state: 'green'
    })
    thread.pokeReview(new Date('2026-01-02T12:00:00.000Z'))
    commitment.pokeReview(new Date('2026-01-03T12:00:00.000Z'))
    const threadId = thread.id
    const commitmentId = commitment.id
    database!.close()

    database = new AppDatabase(databasePath)
    expect(database.domain.threads.materialize(threadId, '2026-01-02')).toMatchObject({
      health: 'green',
      lastReviewDate: '2026-01-02'
    })
    expect(database.domain.commitments.materialize(commitmentId, '2026-01-03')).toMatchObject({
      state: 'green',
      lastReviewDate: '2026-01-03',
      lastUpdateDate: '2026-01-01',
      nextUpdateDate: '2026-01-08'
    })
    expect(database.domain.updates.listForCommitment(commitmentId)).toHaveLength(1)
  })

  it('persists independently editable sensitive flags on Threads, Commitments, and Updates', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Acquisition planning',
      reviewFrequencyDays: 7,
      sensitive: true
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Complete diligence',
      sensitive: true
    })
    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      observation: 'Private counterparty detail',
      sensitive: true
    })

    expect(thread.snapshot()).toMatchObject({ sensitive: true })
    expect(commitment.snapshot()).toMatchObject({ sensitive: true })
    expect(update.toSnapshot()).toMatchObject({ sensitive: true })

    thread.update({ sensitive: false })
    commitment.update({ sensitive: false })
    update.update({ sensitive: false })
    database!.close()
    database = new AppDatabase(databasePath)

    expect(database.domain.threads.requireModel(thread.id).snapshot()).toMatchObject({
      sensitive: false
    })
    expect(database.domain.commitments.requireModel(commitment.id).snapshot()).toMatchObject({
      sensitive: false
    })
    expect(database.domain.updates.requireModel(update.id).toSnapshot()).toMatchObject({
      sensitive: false
    })
    expect(() =>
      database!.domain.threads.requireModel(thread.id).update({ sensitive: 'yes' as never })
    ).toThrow(ModelValidationError)
  })
})
