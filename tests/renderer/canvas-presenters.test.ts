import { describe, expect, it } from 'vitest'
import type {
  CanvasEntityReferenceSnapshot,
  CanvasEntitySnapshot
} from '../../src/shared/contracts'
import {
  canvasCardModel,
  canvasLibraryGroups
} from '../../src/renderer/src/features/canvas/canvas-presenters'

function entity(
  type: CanvasEntitySnapshot['target']['type'],
  id: number,
  overrides: Partial<CanvasEntitySnapshot> = {}
): CanvasEntitySnapshot {
  return {
    target: { type, id },
    title: `${type} ${id}`,
    status: 'active',
    context: 'Project Atlas',
    details: {},
    effectiveSensitive: false,
    createdAt: '2026-08-27T12:00:00.000Z',
    ...overrides
  }
}

describe('Canvas presenters', () => {
  it('partitions all supported kinds and disables only live cards already on the Canvas', () => {
    const entities = [
      entity('thread', 1),
      entity('commitment', 2),
      entity('routine', 3, { status: 'yellow' }),
      entity('note', 4, { status: null }),
      entity('todo', 5, { status: 'done' })
    ]
    const references: CanvasEntityReferenceSnapshot[] = [
      {
        ...entities[0],
        elementId: 'onmove_thread',
        deleted: false,
        deletedAt: null
      },
      {
        ...entity('todo', 5),
        elementId: 'onmove_deleted-todo',
        deleted: true,
        deletedAt: '2026-08-27T12:00:00.000Z'
      }
    ]

    const groups = canvasLibraryGroups(entities, references, false)
    expect(groups.map(({ label }) => label)).toEqual([
      'Threads', 'Commitments', 'Routines', 'Notes', 'Todos'
    ])
    expect(groups.find(({ id }) => id === 'thread')?.items[0]).toMatchObject({
      id: 'thread:1',
      disabled: true
    })
    expect(groups.find(({ id }) => id === 'todo')?.items[0]).toMatchObject({
      id: 'todo:5',
      status: 'done',
      disabled: false
    })
  })

  it('applies sensitive list visibility without removing ordinary records', () => {
    const groups = canvasLibraryGroups([
      entity('thread', 1, { title: 'Public' }),
      entity('thread', 2, { title: 'Private', effectiveSensitive: true })
    ], [], true)
    expect(groups[0].items.map(({ label }) => label)).toEqual(['Public'])
  })

  it('projects kind-specific facts into the widget contract without leaking layout into models', () => {
    const card = canvasCardModel({
      ...entity('commitment', 2, {
        title: 'Resolve rollout risks',
        context: 'Mission Control › Launch readiness',
        details: {
          dueDate: '2026-08-26',
          state: 'yellow',
          lastUpdateDate: '2026-08-27'
        }
      }),
      elementId: 'onmove_commitment',
      deleted: false,
      deletedAt: null
    }, '2026-08-27')

    expect(card).toMatchObject({
      kindLabel: 'Commitment',
      title: 'Resolve rollout risks',
      status: 'Active',
      statusTone: 'primary',
      context: 'Mission Control › Launch readiness',
      facts: [
        { label: 'Due', value: expect.any(String), tone: 'destructive' },
        { label: 'State', value: 'Yellow', tone: 'warning' },
        { label: 'Last update', value: expect.any(String) }
      ]
    })
  })

  it('keeps Thread, Routine, Note, and Todo widget facts specific to their domains', () => {
    const reference = (
      kind: CanvasEntitySnapshot['target']['type'],
      details: CanvasEntitySnapshot['details']
    ): CanvasEntityReferenceSnapshot => ({
      ...entity(kind, 7, { details }),
      elementId: `onmove_${kind}`,
      deleted: false,
      deletedAt: null
    })

    expect(canvasCardModel(reference('thread', {
      dueDate: '2026-09-04',
      reviewFrequencyDays: 7,
      lastUpdateDate: null,
      needsReview: true
    }), '2026-08-27').facts.map(({ label, value }) => [label, value])).toEqual([
      ['Due', expect.any(String)],
      ['Review', 'Every 7d'],
      ['Last update', 'Never']
    ])
    expect(canvasCardModel(reference('routine', {
      nextReviewDate: '2026-08-28',
      scheduleWeekdays: ['monday', 'friday'],
      progress: { complete: 2, required: 4 }
    })).facts.map(({ value }) => value)).toEqual([
      expect.any(String), '2 of 4', 'Mon, Fri'
    ])
    expect(canvasCardModel(reference('note', {
      preview: 'The current decision log.',
      updatedAt: '2026-08-27T12:00:00.000Z'
    })).preview).toBe('The current decision log.')
    expect(canvasCardModel(reference('todo', {
      dueDate: '2026-08-30',
      sharedAcrossSubjects: true,
      completedAt: null
    })).facts.map(({ value }) => value)).toEqual([
      expect.any(String), 'All subjects', 'Open'
    ])
  })
})
