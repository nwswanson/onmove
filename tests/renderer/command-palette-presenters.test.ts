import { describe, expect, it } from 'vitest'
import type {
  CommitmentSnapshot,
  FocusSnapshot,
  SubjectSnapshot,
  ThreadSnapshot,
  TodoSnapshot
} from '../../src/shared/contracts'
import { commandPaletteGroups } from '../../src/renderer/src/features/application/command-palette-presenters'
import type { CommandPaletteSnapshot } from '../../src/renderer/src/features/application/use-command-palette-model'

function focus(overrides: Partial<FocusSnapshot> = {}): FocusSnapshot {
  return {
    id: 1,
    kind: 'generic',
    title: 'Project Atlas',
    description: null,
    status: 'active',
    dueDate: null,
    statusChangedAt: '2026-08-01T12:00:00.000Z',
    lastReviewDate: null,
    needsReview: true,
    sensitive: false,
    notes: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function thread(overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
  return {
    id: 10,
    focusId: 1,
    title: 'Sprint execution',
    health: 'none',
    status: 'active',
    dueDate: null,
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-08-08',
    needsReview: true,
    reviewDue: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function commitment(overrides: Partial<CommitmentSnapshot> = {}): CommitmentSnapshot {
  return {
    id: 20,
    parent: { type: 'thread', id: 10 },
    type: 'tracking',
    title: 'Improve ticket quality',
    status: 'active',
    state: 'none',
    dueDate: null,
    cadenceDays: null,
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-08-08',
    needsReview: true,
    reviewDue: false,
    lastUpdateDate: null,
    nextUpdateDate: null,
    needsUpdate: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function subject(overrides: Partial<SubjectSnapshot> = {}): SubjectSnapshot {
  return {
    id: 30,
    kind: 'generic',
    name: 'North region',
    description: null,
    externalKey: null,
    sensitive: false,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function todo(overrides: Partial<TodoSnapshot> = {}): TodoSnapshot {
  return {
    id: 40,
    name: 'Confirm regional owner',
    parent: {
      type: 'commitment-scope',
      id: 20,
      scope: { scopeId: 4, subjectId: 30 }
    },
    subject: subject(),
    sharedAcrossSubjects: false,
    subjectCompletions: [],
    dueDate: null,
    done: true,
    completedAt: '2026-01-01T12:00:00.000Z',
    sort: [],
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...overrides
  }
}

function snapshot(overrides: Partial<CommandPaletteSnapshot> = {}): CommandPaletteSnapshot {
  return {
    focuses: [focus()],
    threads: [thread()],
    commitments: [commitment()],
    commitmentWorkingContexts: [{
      commitmentId: 20,
      scopeId: 4,
      cells: [{
        scopeId: 4,
        subjectId: 30,
        subject: subject(),
        state: 'yellow',
        lastReviewDate: '2026-08-03',
        nextReviewDate: '2026-08-10',
        reviewDue: false,
        lastUpdateDate: '2026-08-03',
        nextUpdateDate: null,
        needsUpdate: false
      }, {
        scopeId: 4,
        subjectId: 31,
        subject: subject({ id: 31, name: 'South region' }),
        state: 'green',
        lastReviewDate: null,
        nextReviewDate: '2026-08-08',
        reviewDue: false,
        lastUpdateDate: null,
        nextUpdateDate: null,
        needsUpdate: false
      }]
    }],
    todos: [todo()],
    tags: [{ name: 'launch', useCount: 3, sensitiveUseCount: 1 }],
    ...overrides
  }
}

describe('command palette presenters', () => {
  it('projects every searchable record kind into an atomic navigation destination', () => {
    const groups = commandPaletteGroups(snapshot(), false)
    expect(groups.map(({ label }) => label)).toEqual([
      'Focuses',
      'Threads',
      'Commitments',
      'Todos',
      'Tags'
    ])
    expect(groups.flatMap(({ items }) => items)).toMatchObject([
      {
        id: 'focus:1',
        label: 'Project Atlas',
        reference: { value: 'F.1', label: 'Focus ID' },
        destination: {
          type: 'focus',
          target: { focusId: 1, threadId: null, commitmentId: null, subjectId: null }
        }
      },
      {
        id: 'thread:10',
        label: 'Sprint execution',
        reference: { value: 'T.10', label: 'Thread ID' },
        destination: {
          type: 'focus',
          target: { focusId: 1, threadId: 10, commitmentId: null, subjectId: null }
        }
      },
      {
        id: 'commitment:20',
        label: 'Improve ticket quality',
        reference: { value: 'C.20', label: 'Commitment ID' },
        description: 'Project Atlas › Sprint execution › All subjects',
        destination: {
          type: 'focus',
          target: { focusId: 1, threadId: 10, commitmentId: 20, subjectId: null }
        }
      },
      {
        id: 'commitment:20:scope:4:subject:30',
        label: 'Improve ticket quality',
        reference: { value: 'C.20', label: 'Commitment ID' },
        description: 'Project Atlas › Sprint execution › North region',
        destination: {
          type: 'focus',
          target: { focusId: 1, threadId: 10, commitmentId: 20, subjectId: 30 }
        }
      },
      {
        id: 'commitment:20:scope:4:subject:31',
        label: 'Improve ticket quality',
        reference: { value: 'C.20', label: 'Commitment ID' },
        description: 'Project Atlas › Sprint execution › South region',
        destination: {
          type: 'focus',
          target: { focusId: 1, threadId: 10, commitmentId: 20, subjectId: 31 }
        }
      },
      {
        id: 'todo:40',
        label: 'Confirm regional owner',
        reference: { value: 'TD.40', label: 'Todo ID' },
        description: 'Project Atlas › Sprint execution › Improve ticket quality › North region',
        destination: {
          type: 'focus',
          target: { focusId: 1, threadId: 10, commitmentId: 20, subjectId: 30 }
        }
      },
      {
        id: 'tag:launch',
        label: '@launch',
        destination: { type: 'tag', name: 'launch' }
      }
    ])
  })

  it('cascades sensitive visibility through descendants and hides sensitive-only Tags', () => {
    const groups = commandPaletteGroups(snapshot({
      threads: [thread({ sensitive: true })],
      tags: [
        { name: 'public', useCount: 2, sensitiveUseCount: 1 },
        { name: 'secret', useCount: 2, sensitiveUseCount: 2 }
      ]
    }), true)

    expect(groups.map(({ id }) => id)).toEqual(['focuses', 'tags'])
    expect(groups.find(({ id }) => id === 'tags')?.items).toMatchObject([
      { label: '@public', description: '1 use' }
    ])
  })

  it('filters sensitive Commitment scope cells without hiding their ordinary destination', () => {
    const groups = commandPaletteGroups(snapshot({
      commitmentWorkingContexts: [{
        commitmentId: 20,
        scopeId: 4,
        cells: [{
          scopeId: 4,
          subjectId: 30,
          subject: subject({ sensitive: true }),
          state: 'none',
          lastReviewDate: null,
          nextReviewDate: '2026-08-08',
          reviewDue: false,
          lastUpdateDate: null,
          nextUpdateDate: null,
          needsUpdate: false
        }]
      }]
    }), true)

    expect(groups.find(({ id }) => id === 'commitments')?.items).toMatchObject([
      { id: 'commitment:20' }
    ])
  })
})
