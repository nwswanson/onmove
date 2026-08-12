import { describe, expect, it } from 'vitest'
import type { ArchivedUpdateSnapshot } from '../../src/shared/contracts'
import { archivedUpdateItems } from '../../src/renderer/src/features/archive/archive-presenters'

function archived(overrides: Partial<ArchivedUpdateSnapshot> = {}): ArchivedUpdateSnapshot {
  return {
    archiveId: 'a'.repeat(32),
    originalUpdateId: 4,
    parent: { type: 'thread', id: 3 },
    scope: null,
    date: '2026-08-10',
    observation: 'Archived observation',
    state: 'yellow',
    sensitive: false,
    effectiveSensitive: false,
    observationRevision: 1,
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-10T11:00:00.000Z',
    context: {
      focusTitle: 'Project Atlas',
      threadTitle: 'Sprint execution',
      commitmentTitle: null,
      subjectName: null
    },
    deletedAt: '2026-08-12T12:00:00.000Z',
    ...overrides
  }
}

describe('archive presenters', () => {
  it('builds a former hierarchy path and receiver-owned semantic state', () => {
    expect(archivedUpdateItems([archived()], false)).toMatchObject([{
      contextLabel: 'Project Atlas › Sprint execution',
      recordedOn: '2026-08-10',
      state: { label: 'Yellow', tone: 'warning' },
      sensitive: false
    }])
  })

  it('uses durable fallbacks and filters effective ancestor sensitivity', () => {
    const fallback = archived({
      archiveId: 'b'.repeat(32),
      context: {
        focusTitle: null,
        threadTitle: null,
        commitmentTitle: null,
        subjectName: null
      },
      scope: { scopeId: 7, subjectId: 9 }
    })
    const sensitive = archived({
      archiveId: 'c'.repeat(32),
      effectiveSensitive: true
    })

    expect(archivedUpdateItems([fallback], false)[0].contextLabel)
      .toBe('Former Thread #3 › Subject #9')
    expect(archivedUpdateItems([fallback, sensitive], true).map(({ id }) => id))
      .toEqual(['b'.repeat(32)])
  })
})
