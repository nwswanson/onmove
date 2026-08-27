import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OnMoveAccessPolicy } from '../../src/main/application/access-policy'
import { AppDatabase } from '../../src/main/database'

const visible: OnMoveAccessPolicy = { sensitiveContent: 'deny', mutations: 'read-only' }

describe('OnMove MCP hierarchy discovery', () => {
  let directory: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-mcp-hierarchy-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function scopedHierarchy() {
    const focus = database.domain.focuses.create({ title: 'Leadership' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Team management',
      reviewFrequencyDays: 7
    }).snapshot()
    // Regression order: the Commitment exists before the Thread becomes scoped.
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: '1:1s'
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'Michael' })
    const michael = scope.subjects[0]
    const update = database.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      scope: { scopeId: scope.scopeId as number, subjectId: michael.id },
      observation: 'Discussed delivery confidence without repeating the person name.'
    }).toSnapshot()
    return { focus, thread, commitment, scope, michael, update }
  }

  it('turns a Subject name match into every applicable Thread and Commitment path', () => {
    const { focus, thread, commitment, michael } = scopedHierarchy()
    const matches = database.queries.search({ text: 'michael' }, visible)
    const browse = database.queries.browseHierarchy({
      text: 'michael',
      includeSubjects: true,
      includeScopes: true
    }, matches, visible)

    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: { type: 'subject', id: michael.id } })
    ]))
    expect(browse.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'subject',
        hierarchy: {
          focus: { id: focus.id, title: 'Leadership' },
          thread: { id: thread.id, title: 'Team management' },
          commitment: { id: commitment.id, title: '1:1s' }
        },
        subject: { id: michael.id, name: 'Michael' },
        notation: {
          focus: 'Leadership',
          thread: 'Team management',
          commitment: '1:1s',
          subject: 'Michael'
        },
        relativePath: 'Team management > 1:1s[Michael]',
        updateTarget: {
          parent: { type: 'commitment', id: commitment.id },
          attribution: { mode: 'subject', subjectId: michael.id }
        }
      }),
      expect.objectContaining({
        relativePath: 'Team management[Michael]',
        updateTarget: {
          parent: { type: 'thread', id: thread.id },
          attribution: { mode: 'subject', subjectId: michael.id }
        }
      })
    ]))
  })

  it('expands a text-matched Thread into child paths that contain no matching text', () => {
    const { commitment } = scopedHierarchy()
    const matches = database.queries.search({ text: 'team management' }, visible)
    const browse = database.queries.browseHierarchy({
      text: 'team management',
      includeThreads: true,
      includeCommitments: true,
      includeSubjects: true
    }, matches, visible)

    expect(browse.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'commitment',
        hierarchy: expect.objectContaining({
          commitment: { id: commitment.id, title: '1:1s' }
        })
      }),
      expect.objectContaining({ relativePath: 'Team management > 1:1s[Michael]' })
    ]))
  })

  it('uses effective Scope metadata as a hierarchy seed even though Scopes are not text records', () => {
    const focus = database.domain.focuses.create({ title: 'Leadership' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Operating rhythm',
      reviewFrequencyDays: 7
    }).snapshot()
    database.domain.focusScopes.addSubject(focus.id, { name: 'Michael' })
    database.domain.threadScopes.followFocus(thread.id)
    const matches = database.queries.search({ text: 'focus subjects' }, visible)
    const browse = database.queries.browseHierarchy({
      text: 'focus subjects',
      includeThreads: true,
      includeScopes: true
    }, matches, visible)

    expect(matches).toEqual([])
    expect(browse.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'focus',
        hierarchy: expect.objectContaining({ focus: { id: focus.id, title: 'Leadership' } }),
        scope: expect.objectContaining({ name: 'Focus subjects', dimension: 'subject' })
      }),
      expect.objectContaining({
        kind: 'thread',
        hierarchy: expect.objectContaining({ thread: { id: thread.id, title: 'Operating rhythm' } }),
        scope: expect.objectContaining({ name: 'Focus subjects', dimension: 'subject' })
      })
    ]))
  })

  it('lists Subject-attributed records and paths without a text query', () => {
    const { commitment, michael, update } = scopedHierarchy()
    const unrelatedFocus = database.domain.focuses.create({ title: 'Unrelated work' }).toSnapshot()
    database.domain.threads.create({
      focusId: unrelatedFocus.id,
      title: 'Unrelated Thread',
      reviewFrequencyDays: 7
    })
    const items = database.queries.search({
      text: null,
      subjectId: michael.id
    }, visible)
    const browse = database.queries.browseHierarchy({
      text: null,
      subjectId: michael.id,
      includeThreads: true,
      includeCommitments: true,
      includeSubjects: true,
      includeScopes: true
    }, items, visible)

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: { type: 'subject', id: michael.id } }),
      expect.objectContaining({ reference: { type: 'update', id: update.id } })
    ]))
    expect(browse.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hierarchy: expect.objectContaining({
          commitment: { id: commitment.id, title: '1:1s' }
        }),
        subject: { id: michael.id, name: 'Michael' }
      })
    ]))
    expect(browse.paths.some(({ hierarchy }) =>
      hierarchy.focus.id === unrelatedFocus.id)).toBe(false)
  })

  it('applies Thread-level Subject View denial to paths and attributed uses', () => {
    const { thread, michael, update } = scopedHierarchy()
    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: thread.id },
        resource: 'subject',
        view: false,
        edit: false
      }
    })
    const access = database.mcpSettings.accessPolicy()
    const matches = database.queries.search({ text: 'michael' }, access)
    const uses = database.queries.search({ text: null, subjectId: michael.id }, access)
    const browse = database.queries.browseHierarchy({
      text: 'michael',
      includeThreads: true,
      includeCommitments: true,
      includeSubjects: true,
      includeScopes: true
    }, matches, access)

    expect(matches).toEqual([
      expect.objectContaining({ reference: { type: 'subject', id: michael.id } })
    ])
    expect(uses.some(({ reference }) =>
      reference.type === 'update' && reference.id === update.id)).toBe(false)
    expect(browse.paths.some(({ hierarchy }) => hierarchy.thread?.id === thread.id)).toBe(false)
  })

  it('defaults hierarchy browsing to current paths and exposes inherited lifecycle provenance', () => {
    const focus = database.domain.focuses.create({ title: 'Lifecycle hierarchy' }).toSnapshot()
    const makeThread = (
      title: string,
      status: 'paused' | 'done' | 'cancelled',
      subjectName: string
    ) => {
      const thread = database.domain.threads.create({
        focusId: focus.id,
        title,
        status,
        reviewFrequencyDays: 7
      }).snapshot()
      const commitment = database.domain.commitments.create({
        type: 'tracking',
        parent: { type: 'thread', id: thread.id },
        title: `${title} commitment`
      }).snapshot()
      const scope = database.domain.threadScopes.addSubject(thread.id, { name: subjectName })
      return { thread, commitment, subject: scope.subjects[0] }
    }
    const current = makeThread('Paused lane', 'paused', 'Current subject')
    const done = makeThread('Done lane', 'done', 'Done subject')
    const cancelled = makeThread('Cancelled lane', 'cancelled', 'Cancelled subject')
    const browse = database.queries.browseHierarchy({
      text: null,
      includeThreads: true,
      includeCommitments: true,
      includeSubjects: true
    }, [], visible)

    expect(browse.paths.some(({ hierarchy }) => hierarchy.thread?.id === done.thread.id)).toBe(false)
    expect(browse.paths.some(({ hierarchy }) =>
      hierarchy.thread?.id === cancelled.thread.id)).toBe(false)
    expect(browse.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'thread',
        hierarchy: expect.objectContaining({
          thread: { id: current.thread.id, title: 'Paused lane' }
        }),
        lifecycle: {
          directStatus: 'paused',
          effective: 'current',
          lineage: {
            focus: { id: focus.id, status: 'active' },
            thread: { id: current.thread.id, status: 'paused' },
            commitment: null
          }
        }
      }),
      expect.objectContaining({
        kind: 'subject',
        hierarchy: expect.objectContaining({
          commitment: { id: current.commitment.id, title: 'Paused lane commitment' }
        }),
        subject: { id: current.subject.id, name: 'Current subject' },
        lifecycle: {
          directStatus: null,
          effective: 'current',
          lineage: {
            focus: { id: focus.id, status: 'active' },
            thread: { id: current.thread.id, status: 'paused' },
            commitment: { id: current.commitment.id, status: 'active' }
          }
        }
      })
    ]))
  })

  it('widens hierarchy paths consistently for closed/all modes and terminal subsets', () => {
    const focus = database.domain.focuses.create({ title: 'Historical hierarchy' }).toSnapshot()
    const makeThread = (title: string, status: 'active' | 'done' | 'cancelled') => {
      const thread = database.domain.threads.create({
        focusId: focus.id,
        title,
        status,
        reviewFrequencyDays: 7
      }).snapshot()
      const commitment = database.domain.commitments.create({
        type: 'tracking',
        parent: { type: 'thread', id: thread.id },
        title: `${title} commitment`
      }).snapshot()
      const scope = database.domain.threadScopes.addSubject(thread.id, {
        name: `${title} subject`
      })
      return { thread, commitment, subject: scope.subjects[0] }
    }
    const current = makeThread('Current', 'active')
    const done = makeThread('Done', 'done')
    const cancelled = makeThread('Cancelled', 'cancelled')
    const base = {
      text: null,
      includeThreads: true,
      includeCommitments: true,
      includeSubjects: true
    } as const

    const onlyDone = database.queries.browseHierarchy({
      ...base,
      lifecycle: { mode: 'closed', terminalStatuses: ['done'] }
    }, [], visible)
    expect(onlyDone.paths.length).toBeGreaterThan(0)
    expect(onlyDone.paths.every(({ hierarchy }) => hierarchy.thread?.id === done.thread.id))
      .toBe(true)
    expect(onlyDone.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'commitment',
        hierarchy: expect.objectContaining({
          commitment: { id: done.commitment.id, title: 'Done commitment' }
        }),
        lifecycle: {
          directStatus: 'active',
          effective: 'closed',
          lineage: {
            focus: { id: focus.id, status: 'active' },
            thread: { id: done.thread.id, status: 'done' },
            commitment: { id: done.commitment.id, status: 'active' }
          }
        }
      }),
      expect.objectContaining({
        kind: 'subject',
        subject: { id: done.subject.id, name: 'Done subject' },
        lifecycle: expect.objectContaining({ directStatus: null, effective: 'closed' })
      })
    ]))

    const currentAndCancelled = database.queries.browseHierarchy({
      ...base,
      lifecycle: { mode: 'all', terminalStatuses: ['cancelled'] }
    }, [], visible)
    expect(currentAndCancelled.paths.some(({ hierarchy }) =>
      hierarchy.thread?.id === current.thread.id)).toBe(true)
    expect(currentAndCancelled.paths.some(({ hierarchy }) =>
      hierarchy.thread?.id === cancelled.thread.id)).toBe(true)
    expect(currentAndCancelled.paths.some(({ hierarchy }) =>
      hierarchy.thread?.id === done.thread.id)).toBe(false)
    expect(currentAndCancelled.paths.find(({ hierarchy, subject }) =>
      hierarchy.commitment?.id === cancelled.commitment.id &&
      subject?.id === cancelled.subject.id)?.lifecycle).toEqual({
      directStatus: null,
      effective: 'closed',
      lineage: {
        focus: { id: focus.id, status: 'active' },
        thread: { id: cancelled.thread.id, status: 'cancelled' },
        commitment: { id: cancelled.commitment.id, status: 'active' }
      }
    })
  })
})
