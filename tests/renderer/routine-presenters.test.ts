import { describe, expect, it } from 'vitest'
import type {
  RoutineReviewRunSnapshot,
  RoutineSnapshot
} from '../../src/shared/contracts'
import {
  routineDrawerAdapter,
  routineHistoryModel,
  routineWorkingContextModel
} from '../../src/renderer/src/features/routines/routine-presenters'

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
    attestationRequested: true,
    needsAttestation: true,
    scheduleWeekdays: ['monday'],
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
  it('exposes deletion only when the owning Focus or Thread supplies the mutation', () => {
    const onDelete = () => undefined
    const executionOnly = routineDrawerAdapter({
      routine: routine(),
      parentLabel: 'Sprint execution',
      ancestorKeys: ['focus:1', 'thread:21']
    })
    const managed = routineDrawerAdapter({
      routine: routine(),
      parentLabel: 'Sprint execution',
      ancestorKeys: ['focus:1', 'thread:21'],
      onDelete
    })

    expect(executionOnly.model.actions).toBeUndefined()
    expect(managed.model.actions).toEqual([
      expect.objectContaining({
        id: 'delete',
        variant: 'destructive',
        onInvoke: onDelete
      })
    ])
  })

  it('projects current and previous immutable check-ins with editable evidence notes', () => {
    const model = routineHistoryModel(routine())

    expect(model).toMatchObject({
      name: 'Weekly evidence inspection',
      reference: { value: 'R.31', label: 'Routine ID' },
      stateLabel: { label: 'Overdue', tone: 'warning' },
      scheduleLabel: 'Mon',
      scopeLabel: 'No scope',
      nextReviewLabel: 'Next review 2026-08-10',
      needsAttestationLabel: 'Included in Routines'
    })
    expect(model.currentCheckIn).toMatchObject({
      scheduledLabel: 'Scheduled 2026-08-10',
      completionLabel: 'Incomplete',
      progressLabel: '0 of 1 attested',
      templateLabel: 'Template v2',
      late: false
    })
    expect(model.checkIns.map(({ id }) => id)).toEqual(['1'])
    expect(model.checkIns[0]).toMatchObject({
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

  it('projects only concrete Subject tabs and filters history to the selected Subject', () => {
    const scoped = routine()
    const europe = scoped.currentRun!.cells[0]
    scoped.currentRun!.cells = [
      europe,
      {
        ...structuredClone(europe),
        id: 22,
        subject: { id: 10, name: 'North America' },
        items: europe.items.map((item) => ({ ...structuredClone(item), id: item.id + 1 }))
      }
    ]

    expect(routineWorkingContextModel(scoped)).toEqual({
      ariaLabel: 'Routine attestation context',
      items: [
        expect.objectContaining({ id: 'subject:9', label: 'Europe' }),
        expect.objectContaining({ id: 'subject:10', label: 'North America' })
      ]
    })
    expect(routineWorkingContextModel(scoped).items.some(({ id }) => id === 'all')).toBe(false)

    const history = routineHistoryModel(scoped, 10)
    expect(history.currentCheckIn?.cells).toEqual([
      expect.objectContaining({ subjectLabel: 'North America' })
    ])
  })

  it('presents an empty schedule as excluded without erasing the stored preference', () => {
    const unscheduled = {
      ...routine(),
      scheduleWeekdays: [],
      needsAttestation: false,
      nextReviewDate: null,
      nextScheduledDate: null,
      currentRun: null,
      previousRuns: []
    } satisfies RoutineSnapshot

    expect(routineHistoryModel(unscheduled)).toMatchObject({
      scheduleLabel: 'No schedule',
      nextReviewLabel: 'No review scheduled',
      needsAttestationLabel: 'No schedule',
      currentCheckIn: null,
      checkIns: []
    })
    expect(routineDrawerAdapter({
      routine: unscheduled,
      parentLabel: 'Sprint execution',
      ancestorKeys: ['focus:1', 'thread:21']
    }).model.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ label: 'Check every', value: 'No schedule' }),
          expect.objectContaining({ label: 'Needs attestation', value: 'No schedule' })
        ])
      })
    ]))
  })
})
