import { describe, expect, it } from 'vitest'
import type {
  RoutineReviewRunSnapshot,
  RoutineSnapshot
} from '../../src/shared/contracts'
import { routineHistoryModel } from '../../src/renderer/src/features/routines/routine-presenters'

function run({
  id,
  scheduledDate,
  completionDate,
  completedLate = false
}: {
  id: number
  scheduledDate: string
  completionDate: string | null
  completedLate?: boolean
}): RoutineReviewRunSnapshot {
  const complete = completionDate ? 1 : 0
  return {
    id,
    scheduledDate,
    reviewWindowEndsDate: '2026-08-17',
    completionDate,
    completedLate,
    templateVersion: id,
    scope: null,
    progress: { complete, required: 1 },
    items: [],
    cells: [
      {
        id: id * 10,
        subject: { id: 9, name: 'Europe' },
        completionDate,
        completedLate,
        progress: { complete, required: 1 },
        items: [
          {
            id: id * 100,
            runItemId: id * 1000,
            position: 0,
            inspection: 'Verify delivery risks were represented.',
            required: true,
            resolution: completionDate ? 'attested' : 'pending',
            attestedAt: completionDate ? `${completionDate}T12:00:00.000Z` : null,
            note: completionDate ? 'Reviewed the approval evidence.' : '',
            issue: completionDate ? {
              id: id * 10000,
              description: 'Approval record was missing',
              followUpType: 'commitment',
              createdAt: `${completionDate}T12:00:00.000Z`
            } : null
          }
        ]
      }
    ]
  }
}

function routine(): RoutineSnapshot {
  return {
    id: 31,
    parent: { type: 'thread', id: 21 },
    type: 'routine',
    name: 'Weekly evidence inspection',
    sensitive: false,
    needsAttestation: true,
    cadenceDays: 7,
    anchorDate: '2026-08-03',
    scope: null,
    status: 'yellow',
    nextReviewDate: '2026-08-10',
    nextScheduledDate: '2026-08-17',
    overdueDays: 2,
    template: {
      version: 2,
      effectiveAt: '2026-08-10T12:00:00.000Z',
      items: []
    },
    currentRun: run({ id: 2, scheduledDate: '2026-08-10', completionDate: null }),
    previousRuns: [run({
      id: 1,
      scheduledDate: '2026-08-03',
      completionDate: '2026-08-05',
      completedLate: true
    })],
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z'
  }
}

describe('Routine presentation adapters', () => {
  it('projects current and previous immutable check-ins with editable evidence notes', () => {
    const model = routineHistoryModel(routine())

    expect(model).toMatchObject({
      name: 'Weekly evidence inspection',
      stateLabel: { label: 'Overdue', tone: 'warning' },
      cadenceLabel: 'Every 7 days',
      scopeLabel: 'No scope',
      nextReviewLabel: 'Next review 2026-08-10',
      needsAttestationLabel: 'Included in Routines'
    })
    expect(model.checkIns.map(({ id }) => id)).toEqual(['2', '1'])
    expect(model.checkIns[0]).toMatchObject({
      scheduledLabel: 'Scheduled 2026-08-10',
      completionLabel: 'Incomplete',
      progressLabel: '0 of 1 attested',
      templateLabel: 'Template v2',
      late: false
    })
    expect(model.checkIns[1]).toMatchObject({
      scheduledLabel: 'Scheduled 2026-08-03',
      completionLabel: 'Completed 2026-08-05',
      late: true,
      cells: [expect.objectContaining({
        subjectLabel: 'Europe',
        completionLabel: 'Completed 2026-08-05 · late',
        checklist: expect.objectContaining({
          completionDate: '2026-08-05',
          items: [expect.objectContaining({
            resolution: 'attested',
            note: 'Reviewed the approval evidence.'
          })]
        })
      })]
    })
  })
})
