import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    expect(temporaryScope.delete()).toBe(true)
    expect(database!.domain.scopeApplications.get({
      type: 'thread', id: openThread.id
    })).toMatchObject({ mode: 'open', declaredScopeId: null, effectiveScopeId: null })

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
    expect(() => reports.delete()).toThrow('Update history references it')
    expect(() => alex.delete()).toThrow('Update history references it')
    expect(() => membership.delete()).toThrow('scoped Update history exists')
    expect(() => membership.end({ effectiveUntil: '2026-01-10' })).toThrow(
      'before existing scoped Update history'
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
})
