import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('Subject, Scope, and scoped Update models', () => {
  let directory: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-scope-model-test-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('resolves effective-dated includes and excludes over a same-dimension base Scope', () => {
    const focus = database!.domain.focuses.create({ title: 'Team effectiveness' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const jamie = database!.domain.subjects.create({ kind: 'person', name: 'Jamie' })
    const contractor = database!.domain.subjects.create({ kind: 'person', name: 'Morgan' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effectiveFrom: '2026-01-01'
    })
    database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: jamie.id,
      effectiveFrom: '2026-02-01'
    })
    const technicalLeads = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Technical leads',
      dimension: 'people',
      baseScopeId: reports.id
    })
    database!.domain.scopeMemberships.create({
      scopeId: technicalLeads.id,
      subjectId: jamie.id,
      effect: 'exclude',
      effectiveFrom: '2026-03-01'
    })
    database!.domain.scopeMemberships.create({
      scopeId: technicalLeads.id,
      subjectId: contractor.id,
      effectiveFrom: '2026-03-01'
    })

    expect(technicalLeads.effectiveSubjects('2026-01-15').map(({ name }) => name)).toEqual([
      'Alex'
    ])
    expect(technicalLeads.effectiveSubjects('2026-02-15').map(({ name }) => name)).toEqual([
      'Alex',
      'Jamie'
    ])
    expect(technicalLeads.effectiveSubjects('2026-03-15').map(({ name }) => name)).toEqual([
      'Alex',
      'Morgan'
    ])
    expect(() => database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effectiveFrom: '2026-06-01'
    })).toThrow('cannot overlap')

    const temporaryMembership = database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: contractor.id,
      effectiveFrom: '2026-04-01'
    })
    temporaryMembership.end({ effectiveUntil: '2026-05-01' })
    expect(reports.effectiveSubjects('2026-04-30').map(({ name }) => name)).toContain('Morgan')
    expect(reports.effectiveSubjects('2026-05-01').map(({ name }) => name)).not.toContain('Morgan')
  })

  it('validates membership interval edits against resulting applicability and overlap', () => {
    const focus = database!.domain.focuses.create({ title: 'Team effectiveness' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effectiveFrom: '2026-01-01'
    })
    const exclusion = database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effect: 'exclude',
      effectiveFrom: '2026-01-10',
      effectiveUntil: '2026-01-20'
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Hold a career conversation',
      scope: { mode: 'explicit', scopeId: reports.id }
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-25',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })

    exclusion.end({ effectiveUntil: '2026-01-15' })
    expect(reports.effectiveSubjects('2026-01-25').map(({ id }) => id)).toEqual([alex.id])
    expect(() => exclusion.end({ effectiveUntil: '2026-01-30' })).toThrow(
      'invalidate scoped Update history on 2026-01-25'
    )
    expect(exclusion.refresh().toSnapshot().effectiveUntil).toBe('2026-01-15')

    database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effect: 'exclude',
      effectiveFrom: '2026-02-01'
    })
    expect(() => exclusion.end({ effectiveUntil: '2026-02-05' })).toThrow(
      'overlap another interval'
    )
  })

  it('validates derived definitions, base ownership, dimensions, and cycles', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const otherFocus = database!.domain.focuses.create({ title: 'Other project' })
    const project = database!.domain.subjects.create({ kind: 'project', name: 'Project Atlas' })
    const members = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Project members',
      dimension: 'people',
      sourceType: 'derived',
      derivedRelationship: 'members_of',
      contextSubjectId: project.id
    })

    expect(members.toSnapshot()).toMatchObject({
      sourceType: 'derived',
      derivedRelationship: 'members_of',
      contextSubjectId: project.id
    })
    expect(() => database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Invalid explicit Scope',
      dimension: 'people',
      derivedRelationship: 'members_of',
      contextSubjectId: project.id
    })).toThrow('explicit Scope cannot declare')
    expect(() => database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Invalid derived Scope',
      dimension: 'people',
      sourceType: 'derived'
    })).toThrow('derived relationship')

    const other = database!.domain.scopes.create({
      focusId: otherFocus.id,
      name: 'Other people',
      dimension: 'people'
    })
    expect(() => database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Cross-focus base',
      dimension: 'people',
      baseScopeId: other.id
    })).toThrow('same Focus')
    const projects = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Projects',
      dimension: 'projects'
    })
    expect(() => database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Wrong dimension',
      dimension: 'people',
      baseScopeId: projects.id
    })).toThrow('same dimension')

    const first = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'First',
      dimension: 'people'
    })
    const second = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Second',
      dimension: 'people',
      baseScopeId: first.id
    })
    expect(() => first.update({ baseScopeId: second.id })).toThrow('cycle')
  })

  it('supports Open, inherited, explicit, and derived applicability without widening parents', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const context = database!.domain.subjects.create({ kind: 'project', name: 'Project Atlas' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    const projectMembers = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Project members',
      dimension: 'people',
      sourceType: 'derived',
      derivedRelationship: 'members_of',
      contextSubjectId: context.id
    })
    const openThread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Executive alignment',
      reviewFrequencyDays: 7
    })
    expect(database!.domain.scopeApplications.get({ type: 'focus', id: focus.id })).toMatchObject({
      mode: 'open',
      effectiveScopeId: null
    })
    expect(database!.domain.scopeApplications.get({ type: 'thread', id: openThread.id })).toMatchObject({
      mode: 'open',
      effectiveScopeId: null
    })

    database!.domain.scopeApplications.set(
      { type: 'focus', id: focus.id },
      { mode: 'explicit', scopeId: reports.id }
    )
    const inheritedThread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Career direction',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: inheritedThread.id },
      type: 'ongoing',
      title: 'Discuss career direction'
    })
    expect(database!.domain.scopeApplications.get({
      type: 'thread', id: inheritedThread.id
    })).toMatchObject({
      mode: 'inherited',
      effectiveScopeId: reports.id,
      inheritedFrom: { type: 'focus', id: focus.id }
    })
    expect(database!.domain.scopeApplications.get({
      type: 'commitment', id: commitment.id
    })).toMatchObject({
      mode: 'inherited',
      effectiveScopeId: reports.id,
      inheritedFrom: { type: 'thread', id: inheritedThread.id }
    })

    database!.domain.scopeApplications.set(
      { type: 'thread', id: inheritedThread.id },
      { mode: 'derived', scopeId: projectMembers.id }
    )
    expect(database!.domain.scopeApplications.get({
      type: 'commitment', id: commitment.id
    }).effectiveScopeId).toBe(projectMembers.id)
    expect(database!.domain.scopeApplications.get({ type: 'focus', id: focus.id }).effectiveScopeId)
      .toBe(reports.id)

    database!.domain.scopeApplications.set(
      { type: 'thread', id: inheritedThread.id },
      { mode: 'open' }
    )
    expect(database!.domain.scopeApplications.get({
      type: 'commitment', id: commitment.id
    })).toMatchObject({ mode: 'inherited', effectiveScopeId: null })

    const temporaryScope = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Temporary local population',
      dimension: 'people'
    })
    database!.domain.scopeApplications.set(
      { type: 'thread', id: openThread.id },
      { mode: 'explicit', scopeId: temporaryScope.id }
    )
    expect(() => temporaryScope.delete()).toThrow('applicability history references it')
    expect(database!.domain.scopeApplications.get({
      type: 'thread', id: openThread.id
    })).toMatchObject({
      mode: 'explicit',
      declaredScopeId: temporaryScope.id,
      effectiveScopeId: temporaryScope.id
    })

    const otherFocus = database!.domain.focuses.create({ title: 'Other' })
    const foreignScope = database!.domain.scopes.create({
      focusId: otherFocus.id,
      name: 'Foreign',
      dimension: 'people'
    })
    expect(() => database!.domain.scopeApplications.set(
      { type: 'thread', id: inheritedThread.id },
      { mode: 'explicit', scopeId: foreignScope.id }
    )).toThrow('owned by its Focus')
    expect(() => database!.domain.scopeApplications.set(
      { type: 'thread', id: inheritedThread.id },
      { mode: 'explicit', scopeId: projectMembers.id }
    )).toThrow('requires a explicit Scope definition')
    expect(() => database!.domain.scopeApplications.set(
      { type: 'focus', id: focus.id },
      { mode: 'inherited' }
    )).toThrow('cannot inherit')
    expect(() => database!.domain.scopeApplications.set(
      { type: 'thread', id: openThread.id },
      { mode: 'inherited' }
    )).not.toThrow()
    expect(() => temporaryScope.delete()).toThrow('applicability history references it')
  })

  it('audits applicability changes and keeps removed cells observable without keeping them current', () => {
    const focus = database!.domain.focuses.create({ title: 'Team effectiveness' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const jamie = database!.domain.subjects.create({ kind: 'person', name: 'Jamie' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    const leads = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Technical leads',
      dimension: 'people'
    })
    const alexMembership = database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effectiveFrom: '2026-01-01'
    })
    database!.domain.scopeMemberships.create({
      scopeId: leads.id,
      subjectId: jamie.id,
      effectiveFrom: '2026-01-01'
    })
    const thread = database!.domain.threads.create(
      {
        focusId: focus.id,
        title: 'Career direction is current',
        reviewFrequencyDays: 7,
        scope: { mode: 'explicit', scopeId: reports.id }
      },
      new Date('2026-01-01T12:00:00.000Z')
    )
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Hold a substantive career conversation'
    })
    const alexReview = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-08',
      state: 'green',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })

    expect(thread.scopeApplicationHistory()).toMatchObject([
      { from: null, to: { mode: 'open', scopeId: null } },
      {
        from: { mode: 'open', scopeId: null },
        to: { mode: 'explicit', scopeId: reports.id }
      }
    ])
    expect(commitment.scopeApplicationHistory()).toMatchObject([
      { from: null, to: { mode: 'inherited', scopeId: null } }
    ])

    thread.setScope({ mode: 'explicit', scopeId: reports.id })
    expect(thread.scopeApplicationHistory()).toHaveLength(2)

    thread.setScope({ mode: 'explicit', scopeId: leads.id })
    expect(thread.scopeMatrix('2026-01-10').map(({ subjectId }) => subjectId)).toEqual([
      jamie.id
    ])
    expect(commitment.scopeApplication()).toMatchObject({
      mode: 'inherited',
      effectiveScopeId: leads.id,
      inheritedFrom: { type: 'thread', id: thread.id }
    })
    expect(commitment.scopeApplicationHistory()).toHaveLength(1)
    expect(thread.scopeApplicationHistory().at(-1)).toMatchObject({
      from: { mode: 'explicit', scopeId: reports.id },
      to: { mode: 'explicit', scopeId: leads.id }
    })
    expect(database!.domain.updates.listForThread(thread.id)).toMatchObject([
      { id: alexReview.id, scope: { scopeId: reports.id, subjectId: alex.id } }
    ])

    thread.setScope({ mode: 'open' })
    expect(thread.scopeMatrix('2026-01-10')).toEqual([])
    expect(commitment.scopeApplication().effectiveScopeId).toBeNull()

    thread.setScope({ mode: 'explicit', scopeId: reports.id })
    expect(thread.scopeMatrix('2026-01-10')).toEqual([
      expect.objectContaining({
        subjectId: alex.id,
        lastReviewDate: '2026-01-08',
        state: 'green'
      })
    ])
    expect(() => reports.update({ dimension: 'teams' })).toThrow(
      'create a new Scope instead'
    )
    expect(() => alexMembership.delete()).toThrow('end it instead')

    alexMembership.end({ effectiveUntil: '2026-02-01' })
    expect(thread.scopeMatrix('2026-02-01')).toEqual([])
    expect(database!.domain.updates.listForThread(thread.id)).toHaveLength(1)
    expect(() => alex.delete()).toThrow('Scope or Update history references it')
  })

  it('hard-deletes scoped owners and their evidence without deleting shared Scope or Subject records', () => {
    const focus = database!.domain.focuses.create({ title: 'Team effectiveness' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effectiveFrom: '2026-01-01'
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Career direction',
      reviewFrequencyDays: 7,
      scope: { mode: 'explicit', scopeId: reports.id }
    })
    const childCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Hold career conversations'
    })
    const directCommitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Review growth plans',
      scope: { mode: 'explicit', scopeId: reports.id }
    })
    const threadUpdate = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-08',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    const childUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: childCommitment.id },
      date: '2026-01-08',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    const directUpdate = database!.domain.updates.create({
      parent: { type: 'commitment', id: directCommitment.id },
      date: '2026-01-08',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })

    expect(directCommitment.delete()).toBe(true)
    expect(database!.domain.updates.find(directUpdate.id)).toBeNull()
    expect(database!.domain.scopes.find(reports.id)).not.toBeNull()
    expect(database!.domain.subjects.find(alex.id)).not.toBeNull()

    expect(thread.delete()).toBe(true)
    expect(database!.domain.commitments.find(childCommitment.id)).toBeNull()
    expect(database!.domain.updates.find(threadUpdate.id)).toBeNull()
    expect(database!.domain.updates.find(childUpdate.id)).toBeNull()
    expect(database!.domain.scopes.find(reports.id)).not.toBeNull()
    expect(database!.domain.scopes.effectiveSubjects(reports.id, '2026-01-08')).toMatchObject([
      { id: alex.id, name: 'Alex' }
    ])

    const raw = new DatabaseSync(join(directory, 'onmove.sqlite3'))
    const deletedOwnerHistory = raw.prepare(
      `SELECT count(*) AS count FROM scope_application_transitions
       WHERE thread_id = ? OR commitment_id IN (?, ?)`
    ).get(thread.id, childCommitment.id, directCommitment.id) as { count: number }
    raw.close()
    expect(Number(deletedOwnerHistory.count)).toBe(0)
    expect(() => alex.delete()).toThrow('Scope or Update history references it')
  })

  it('requires a valid effective Scope and Subject cell for scoped Updates', () => {
    const focus = database!.domain.focuses.create({ title: 'Team health' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const jamie = database!.domain.subjects.create({ kind: 'person', name: 'Jamie' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effectiveFrom: '2026-01-01'
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Hold a career conversation',
      scope: { mode: 'explicit', scopeId: reports.id }
    })

    expect(() => database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Missing cell'
    })).toThrow('requires a Scope and Subject cell')
    expect(() => database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      scope: { scopeId: reports.id, subjectId: jamie.id }
    })).toThrow('not an effective member')
    expect(() => database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2025-12-31',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })).toThrow('not an effective member')

    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-10',
      observation: 'Career direction is clear',
      state: 'green',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    expect(update.toSnapshot()).toMatchObject({
      scope: { scopeId: reports.id, subjectId: alex.id },
      state: 'green'
    })
    expect(() => update.update({ date: '2025-12-31' })).toThrow('not an effective member')
    expect(update.refresh().toSnapshot().date).toBe('2026-01-10')

    const openCommitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'action',
      title: 'Obtain executive approval'
    })
    expect(() => database!.domain.updates.create({
      parent: { type: 'commitment', id: openCommitment.id },
      scope: { scopeId: reports.id, subjectId: alex.id }
    })).toThrow('Open parent')
    expect(() => database!.domain.updates.create({
      parent: { type: 'focus', id: focus.id },
      scope: { scopeId: reports.id, subjectId: alex.id }
    })).toThrow('direct Focus Update')
  })

  it('accepts Thread-wide evidence when a Thread has no effective Subjects', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Team health' })
    const emptyScope = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'No current teams',
      dimension: 'teams'
    }, now)
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Team-wide observation',
      reviewFrequencyDays: 7,
      scope: { mode: 'explicit', scopeId: emptyScope.id }
    }, now)

    const update = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-02',
      observation: 'No Subject boundary applies yet',
      state: 'green'
    }, now)

    expect(update.toSnapshot().scope).toBeNull()
    expect(thread.snapshot('2026-01-02')).toMatchObject({
      health: 'green',
      lastReviewDate: '2026-01-02'
    })

    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Subject-specific work',
      scope: { mode: 'explicit', scopeId: emptyScope.id }
    }, now)
    expect(() => database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-02'
    }, now)).toThrow('requires a Scope and Subject cell')
  })

  it('materializes scoped Commitment state and cadence per Subject cell', () => {
    const focus = database!.domain.focuses.create({ title: 'Career development' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const jamie = database!.domain.subjects.create({ kind: 'person', name: 'Jamie' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    for (const subject of [alex, jamie]) {
      database!.domain.scopeMemberships.create({
        scopeId: reports.id,
        subjectId: subject.id,
        effectiveFrom: '2026-01-01'
      })
    }
    const commitment = database!.domain.commitments.create(
      {
        parent: { type: 'focus', id: focus.id },
        type: 'ongoing',
        title: 'Hold substantive one-on-ones',
        cadenceDays: 7,
        scope: { mode: 'explicit', scopeId: reports.id }
      },
      new Date('2026-01-01T12:00:00.000Z')
    )
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-07',
      state: 'green',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-05',
      state: 'red',
      scope: { scopeId: reports.id, subjectId: jamie.id }
    })

    expect(commitment.snapshot('2026-01-12')).toMatchObject({
      state: 'red',
      lastUpdateDate: '2026-01-07',
      nextUpdateDate: '2026-01-12',
      needsUpdate: true
    })
    expect(commitment.scopeMatrix('2026-01-12')).toEqual([
      expect.objectContaining({
        subjectId: alex.id,
        state: 'green',
        lastUpdateDate: '2026-01-07',
        nextUpdateDate: '2026-01-14',
        needsUpdate: false
      }),
      expect.objectContaining({
        subjectId: jamie.id,
        state: 'red',
        lastUpdateDate: '2026-01-05',
        nextUpdateDate: '2026-01-12',
        needsUpdate: true
      })
    ])
  })

  it('materializes a Thread Subject lens with only matching bounded Commitment cells', () => {
    const now = new Date('2026-01-08T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const customer = database!.domain.subjects.create({ name: 'Customer Operations' })
    const platform = database!.domain.subjects.create({ name: 'Platform Team' })
    const portfolio = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Portfolio',
      dimension: 'team'
    })
    for (const subject of [customer, platform]) {
      database!.domain.scopeMemberships.create({
        scopeId: portfolio.id,
        subjectId: subject.id,
        effectiveFrom: '2026-01-01'
      })
    }
    focus.setScope({ mode: 'explicit', scopeId: portfolio.id })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    const inherited = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    }, now)
    const open = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Unscoped coordination',
      scope: { mode: 'open' }
    }, now)
    database!.domain.updates.create({
      parent: { type: 'commitment', id: inherited.id },
      date: '2026-01-08',
      state: 'red',
      scope: { scopeId: portfolio.id, subjectId: customer.id }
    }, now)
    database!.domain.updates.create({
      parent: { type: 'commitment', id: inherited.id },
      date: '2026-01-07',
      state: 'green',
      scope: { scopeId: portfolio.id, subjectId: platform.id }
    }, now)

    const matrix = thread.subjectMatrix('2026-01-08')
    expect(matrix.map(({ subjectId }) => subjectId)).toEqual([customer.id, platform.id])
    expect(matrix[0].commitments).toEqual([
      expect.objectContaining({
        commitmentId: inherited.id,
        scopeId: portfolio.id,
        subjectId: customer.id,
        state: 'red',
        lastUpdateDate: '2026-01-08'
      })
    ])
    expect(matrix[1].commitments).toEqual([
      expect.objectContaining({
        commitmentId: inherited.id,
        subjectId: platform.id,
        state: 'green',
        lastUpdateDate: '2026-01-07'
      })
    ])
    expect(matrix.flatMap(({ commitments }) => commitments)
      .some(({ commitmentId }) => commitmentId === open.id)).toBe(false)
  })

  it('derives scoped Thread health across assessed and unassessed Subjects', () => {
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const jamie = database!.domain.subjects.create({ kind: 'person', name: 'Jamie' })
    const people = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Project members',
      dimension: 'people'
    })
    for (const subject of [alex, jamie]) {
      database!.domain.scopeMemberships.create({
        scopeId: people.id,
        subjectId: subject.id,
        effectiveFrom: '2026-01-01'
      })
    }
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Team health',
      reviewFrequencyDays: 7,
      scope: { mode: 'explicit', scopeId: people.id }
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-05',
      state: 'green',
      scope: { scopeId: people.id, subjectId: alex.id }
    })
    expect(thread.snapshot('2026-01-05').health).toBe('none')
    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-05',
      state: 'yellow',
      scope: { scopeId: people.id, subjectId: jamie.id }
    })
    expect(thread.snapshot('2026-01-05')).toMatchObject({
      health: 'yellow',
      lastReviewDate: '2026-01-05'
    })
  })

  it('materializes independent Thread reviews for every effective Subject', () => {
    const focus = database!.domain.focuses.create({ title: 'Team effectiveness' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const jamie = database!.domain.subjects.create({ kind: 'person', name: 'Jamie' })
    const morgan = database!.domain.subjects.create({ kind: 'person', name: 'Morgan' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    for (const subject of [alex, jamie]) {
      database!.domain.scopeMemberships.create({
        scopeId: reports.id,
        subjectId: subject.id,
        effectiveFrom: '2026-01-01'
      })
    }
    database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: morgan.id,
      effectiveFrom: '2026-01-20',
      effectiveUntil: '2026-01-25'
    })
    const thread = database!.domain.threads.create(
      {
        focusId: focus.id,
        title: 'Career direction is current',
        reviewFrequencyDays: 7,
        scope: { mode: 'explicit', scopeId: reports.id }
      },
      new Date('2026-01-01T12:00:00.000Z')
    )

    expect(thread.scopeMatrix('2026-01-08')).toEqual([
      expect.objectContaining({
        scopeId: reports.id,
        subjectId: alex.id,
        state: 'none',
        lastReviewDate: null,
        nextReviewDate: '2026-01-08',
        reviewDue: true
      }),
      expect.objectContaining({
        scopeId: reports.id,
        subjectId: jamie.id,
        state: 'none',
        lastReviewDate: null,
        nextReviewDate: '2026-01-08',
        reviewDue: true
      })
    ])

    const alexReview = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-08',
      state: 'green',
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    expect(thread.snapshot('2026-01-10')).toMatchObject({
      lastReviewDate: null,
      nextReviewDate: '2026-01-08',
      reviewDue: true
    })
    expect(thread.scopeMatrix('2026-01-10')).toEqual([
      expect.objectContaining({
        subjectId: alex.id,
        lastReviewDate: '2026-01-08',
        nextReviewDate: '2026-01-15',
        reviewDue: false
      }),
      expect.objectContaining({
        subjectId: jamie.id,
        lastReviewDate: null,
        nextReviewDate: '2026-01-08',
        reviewDue: true
      })
    ])

    database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-01-10',
      state: 'green',
      scope: { scopeId: reports.id, subjectId: jamie.id }
    })
    expect(thread.snapshot('2026-01-10')).toMatchObject({
      lastReviewDate: '2026-01-08',
      nextReviewDate: '2026-01-15',
      reviewDue: false
    })
    expect(thread.scopeMatrix('2026-01-16')).toEqual([
      expect.objectContaining({ subjectId: alex.id, reviewDue: true }),
      expect.objectContaining({ subjectId: jamie.id, reviewDue: false })
    ])

    expect(thread.scopeMatrix('2026-01-20')).toEqual([
      expect.objectContaining({ subjectId: alex.id }),
      expect.objectContaining({ subjectId: jamie.id }),
      expect.objectContaining({
        subjectId: morgan.id,
        lastReviewDate: null,
        nextReviewDate: '2026-01-08',
        reviewDue: true
      })
    ])
    expect(thread.snapshot('2026-01-20').lastReviewDate).toBeNull()
    expect(thread.scopeMatrix('2026-01-25').map(({ subjectId }) => subjectId)).toEqual([
      alex.id,
      jamie.id
    ])

    expect(alexReview.delete()).toBe(true)
    expect(thread.scopeMatrix('2026-01-25')).toEqual([
      expect.objectContaining({
        subjectId: alex.id,
        lastReviewDate: null,
        reviewDue: true
      }),
      expect.objectContaining({ subjectId: jamie.id, lastReviewDate: '2026-01-10' })
    ])
    expect(thread.snapshot('2026-01-25').lastReviewDate).toBeNull()

    thread.update({ needsReview: false })
    expect(thread.scopeMatrix('2026-01-20').every(({ reviewDue }) => !reviewDue)).toBe(true)
    expect(thread.snapshot('2026-01-20').reviewDue).toBe(false)

    thread.update({ needsReview: true, status: 'paused' })
    expect(thread.scopeMatrix('2026-01-20').every(({ reviewDue }) => !reviewDue)).toBe(true)
    expect(thread.snapshot('2026-01-20').reviewDue).toBe(false)

    const openThread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Aggregate alignment',
      reviewFrequencyDays: 7,
      scope: { mode: 'open' }
    })
    expect(openThread.scopeMatrix('2026-01-20')).toEqual([])
  })

  it('preserves scoped Update history when membership or applicability later changes', () => {
    const focus = database!.domain.focuses.create({ title: 'Team health' })
    const alex = database!.domain.subjects.create({ kind: 'person', name: 'Alex' })
    const reports = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Direct reports',
      dimension: 'people'
    })
    const membership = database!.domain.scopeMemberships.create({
      scopeId: reports.id,
      subjectId: alex.id,
      effectiveFrom: '2026-01-01',
      effectiveUntil: '2026-02-01'
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Discuss career direction',
      scope: { mode: 'explicit', scopeId: reports.id }
    })
    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      date: '2026-01-15',
      scope: { scopeId: reports.id, subjectId: alex.id },
      state: 'green'
    })

    database!.domain.scopeApplications.set(
      { type: 'commitment', id: commitment.id },
      { mode: 'open' }
    )
    expect(database!.domain.updates.listForCommitment(commitment.id)[0]).toMatchObject({
      id: update.id,
      scope: { scopeId: reports.id, subjectId: alex.id }
    })
    expect(() => reports.delete()).toThrow('Update or applicability history references it')
    expect(() => alex.delete()).toThrow('Update history references it')
    expect(() => membership.delete()).toThrow('end it instead')
    expect(() => membership.end({ effectiveUntil: '2026-01-10' })).toThrow(
      'invalidate scoped Update history'
    )

    const otherScope = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Other people set',
      dimension: 'people'
    })
    const unrelatedMembership = database!.domain.scopeMemberships.create({
      scopeId: otherScope.id,
      subjectId: alex.id,
      effectiveFrom: '2026-01-01'
    })
    expect(unrelatedMembership.delete()).toBe(true)

    expect(focus.delete()).toBe(true)
    expect(database!.domain.updates.find(update.id)).toBeNull()
    expect(database!.domain.scopes.find(reports.id)).toBeNull()
    expect(database!.domain.subjects.find(alex.id)).not.toBeNull()
  })

  it('coordinates the Focus Scope editor as one atomic Subject-set boundary', () => {
    const focus = database!.domain.focuses.create({ title: 'Launch quality' })
    const firstDay = new Date('2026-08-08T12:00:00.000Z')
    const nextDay = new Date('2026-08-09T12:00:00.000Z')

    expect(database!.domain.focusScopes.get(focus.id, '2026-08-08')).toEqual({
      focusId: focus.id,
      mode: 'open',
      scopeId: null,
      subjects: []
    })

    const withCustomerOperations = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: '  Customer Operations  ' },
      firstDay
    )
    expect(withCustomerOperations).toMatchObject({
      focusId: focus.id,
      mode: 'explicit',
      subjects: [{ name: 'Customer Operations' }]
    })
    const scopeId = withCustomerOperations.scopeId as number
    const subjectId = withCustomerOperations.subjects[0].id
    expect(database!.domain.scopeApplications.get({ type: 'focus', id: focus.id })).toMatchObject({
      mode: 'explicit',
      declaredScopeId: scopeId
    })

    const unchanged = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'customer operations' },
      firstDay
    )
    expect(unchanged.subjects).toHaveLength(1)
    expect(database!.domain.subjects.list()).toHaveLength(1)

    expect(database!.domain.focusScopes.removeSubject(focus.id, subjectId, firstDay).subjects)
      .toEqual([])
    expect(database!.domain.subjects.find(subjectId)).not.toBeNull()
    expect(database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Customer Operations' },
      firstDay
    ).subjects.map(({ id }) => id)).toEqual([subjectId])

    expect(database!.domain.focusScopes.removeSubject(focus.id, subjectId, nextDay).subjects)
      .toEqual([])
    expect(database!.domain.scopes.effectiveSubjects(scopeId, '2026-08-08').map(({ id }) => id))
      .toEqual([subjectId])
    expect(database!.domain.scopes.effectiveSubjects(scopeId, '2026-08-09')).toEqual([])
    expect(database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Customer Operations' },
      nextDay
    ).subjects.map(({ id }) => id)).toEqual([subjectId])
  })

  it('customizes a Thread Scope without mutating its Focus, siblings, or retained evidence', () => {
    const firstDay = new Date('2026-08-08T12:00:00.000Z')
    const nextDay = new Date('2026-08-09T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Launch quality' })
    const focusScope = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Customer Operations' },
      firstDay
    )
    database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Platform Team' },
      firstDay
    )
    const customerOperationsId = focusScope.subjects[0].id
    const platformTeamId = database!.domain.subjects.list()
      .find(({ name }) => name === 'Platform Team')!.id
    const sprint = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, firstDay)
    const teamHealth = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Team health',
      reviewFrequencyDays: 7
    }, firstDay)

    expect(database!.domain.threadScopes.get(sprint.id, '2026-08-08')).toMatchObject({
      mode: 'inherited',
      subjects: [{ id: customerOperationsId }, { id: platformTeamId }],
      focusSubjects: [{ id: customerOperationsId }, { id: platformTeamId }]
    })
    database!.domain.updates.create({
      parent: { type: 'thread', id: sprint.id },
      date: '2026-08-08',
      state: 'green',
      scope: { scopeId: focusScope.scopeId as number, subjectId: customerOperationsId }
    }, firstDay)

    const narrowed = database!.domain.threadScopes.removeSubject(
      sprint.id,
      customerOperationsId,
      firstDay
    )
    expect(narrowed).toMatchObject({
      mode: 'explicit',
      subjects: [{ id: platformTeamId }]
    })
    const firstCustomScopeId = narrowed.scopeId as number
    expect(database!.domain.focusScopes.get(focus.id, '2026-08-08').subjects.map(({ id }) => id))
      .toEqual([customerOperationsId, platformTeamId])
    expect(database!.domain.threadScopes.get(teamHealth.id, '2026-08-08').subjects.map(({ id }) => id))
      .toEqual([customerOperationsId, platformTeamId])
    expect(database!.domain.updates.listForThread(sprint.id)).toMatchObject([
      { state: 'green', scope: { scopeId: focusScope.scopeId, subjectId: customerOperationsId } }
    ])
    expect(sprint.scopeMatrix('2026-08-08').map(({ subjectId }) => subjectId))
      .toEqual([platformTeamId])

    const restored = database!.domain.threadScopes.addSubject(
      sprint.id,
      { name: 'customer operations' },
      firstDay
    )
    expect(restored.subjects.map(({ id }) => id)).toEqual([
      customerOperationsId,
      platformTeamId
    ])
    expect(restored.scopeId).not.toBe(firstCustomScopeId)
    expect(sprint.scopeMatrix('2026-08-08')).toEqual([
      expect.objectContaining({ subjectId: customerOperationsId, state: 'none' }),
      expect.objectContaining({ subjectId: platformTeamId, state: 'none' })
    ])

    const extended = database!.domain.threadScopes.addSubject(
      sprint.id,
      { name: 'Delivery Partners' },
      firstDay
    )
    const deliveryPartnersId = extended.subjects
      .find(({ name }) => name === 'Delivery Partners')!.id
    expect(extended.subjects.map(({ id }) => id)).toEqual([
      customerOperationsId,
      deliveryPartnersId,
      platformTeamId
    ])
    expect(database!.domain.focusScopes.get(focus.id, '2026-08-08').subjects.map(({ id }) => id))
      .toEqual([customerOperationsId, platformTeamId])

    const followed = database!.domain.threadScopes.followFocus(sprint.id, firstDay)
    expect(followed).toMatchObject({
      mode: 'inherited',
      scopeId: focusScope.scopeId,
      subjects: [{ id: customerOperationsId }, { id: platformTeamId }]
    })
    expect(sprint.scopeApplicationHistory().map(({ to }) => to.mode)).toEqual([
      'inherited',
      'explicit',
      'explicit',
      'explicit',
      'inherited'
    ])

    database!.domain.focusScopes.removeSubject(focus.id, platformTeamId, nextDay)
    expect(database!.domain.threadScopes.get(sprint.id, '2026-08-09').subjects.map(({ id }) => id))
      .toEqual([customerOperationsId])
    expect(database!.domain.threadScopes.get(teamHealth.id, '2026-08-09').subjects.map(({ id }) => id))
      .toEqual([customerOperationsId])

    expect(sprint.delete()).toBe(true)
    expect(database!.domain.scopes.find(firstCustomScopeId)).not.toBeNull()
    expect(database!.domain.subjects.find(deliveryPartnersId)).not.toBeNull()
    expect(database!.domain.threadScopes.get(teamHealth.id, '2026-08-09').subjects.map(({ id }) => id))
      .toEqual([customerOperationsId])
    expect(focus.delete()).toBe(true)
    expect(database!.domain.scopes.find(firstCustomScopeId)).toBeNull()
    expect(database!.domain.subjects.find(deliveryPartnersId)).not.toBeNull()
  })

  it('switches a Thread between live Focus inheritance and an independent custom overlay', () => {
    const now = new Date('2026-08-08T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Project Atlas' })
    const bounded = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Customer Operations' },
      now
    )
    database!.domain.focusScopes.addSubject(focus.id, { name: 'Platform Team' }, now)
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)

    expect(database!.domain.threadScopes.get(thread.id, '2026-08-08')).toMatchObject({
      mode: 'inherited',
      scopeId: bounded.scopeId
    })
    const custom = database!.domain.threadScopes.customize(thread.id, now)
    expect(custom).toMatchObject({
      mode: 'explicit',
      subjects: [{ name: 'Customer Operations' }, { name: 'Platform Team' }]
    })
    expect(custom.scopeId).not.toBe(bounded.scopeId)

    database!.domain.threadScopes.removeSubject(thread.id, bounded.subjects[0].id, now)
    expect(database!.domain.threadScopes.get(thread.id, '2026-08-08').subjects.map(({ name }) => name))
      .toEqual(['Platform Team'])
    expect(database!.domain.focusScopes.get(focus.id, '2026-08-08').subjects.map(({ name }) => name))
      .toEqual(['Customer Operations', 'Platform Team'])

    const inherited = database!.domain.threadScopes.followFocus(
      thread.id,
      now
    )
    expect(inherited).toMatchObject({
      mode: 'inherited',
      subjects: [{ name: 'Customer Operations' }, { name: 'Platform Team' }]
    })
    expect(thread.scopeApplicationHistory().map(({ to }) => to.mode)).toEqual([
      'inherited',
      'explicit',
      'explicit',
      'inherited'
    ])
  })

  it('cascades an active Thread and its nested overlay Scope chain with its Focus', () => {
    const now = new Date('2026-08-08T12:00:00.000Z')
    const focus = database!.domain.focuses.create({ title: 'Launch quality' })
    const bounded = database!.domain.focusScopes.addSubject(
      focus.id,
      { name: 'Customer Operations' },
      now
    )
    const customerOperationsId = bounded.subjects[0].id
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    database!.domain.threadScopes.removeSubject(thread.id, customerOperationsId, now)
    database!.domain.threadScopes.addSubject(thread.id, { name: 'Customer Operations' }, now)
    database!.domain.threadScopes.addSubject(thread.id, { name: 'Delivery Partners' }, now)
    database!.domain.threadScopes.followFocus(thread.id, now)
    database!.domain.threadScopes.removeSubject(thread.id, customerOperationsId, now)

    expect(focus.delete()).toBe(true)
    expect(database!.domain.threads.find(thread.id)).toBeNull()
    expect(database!.domain.scopes.listForFocus(focus.id)).toEqual([])
    expect(database!.domain.subjects.list().map(({ name }) => name)).toEqual([
      'Customer Operations',
      'Delivery Partners'
    ])
  })
})
