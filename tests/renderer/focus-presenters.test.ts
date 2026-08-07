import { describe, expect, it, vi } from 'vitest'
import type {
  CommitmentSnapshot,
  FocusSnapshot,
  ThreadSnapshot
} from '../../src/shared/contracts'
import {
  commitmentContextSidebarItems,
  commitmentDrawerAdapter,
  focusContextSidebarItems,
  focusDrawerAdapter,
  focusPrimaryNavigationItems
} from '../../src/renderer/src/features/focus/focus-presenters'
import { healthStateLabel } from '../../src/renderer/src/features/shared/state-presenters'

const focus: FocusSnapshot = {
  id: 1,
  kind: 'generic',
  title: 'Project Atlas',
  description: 'Launch notes',
  goal: 'Ship safely',
  status: 'active',
  statusChangedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const thread: ThreadSnapshot = {
  id: 10,
  focusId: 1,
  title: 'Sprint execution',
  health: 'none',
  status: 'paused',
  reviewFrequencyDays: 7,
  lastReviewDate: null,
  nextReviewDate: '2026-01-08',
  needsReview: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const commitment: CommitmentSnapshot = {
  id: 20,
  parent: { type: 'focus', id: 1 },
  type: 'ongoing',
  title: 'Improve ticket quality',
  status: 'active',
  state: 'green',
  dueDate: null,
  cadenceDays: null,
  lastUpdateDate: null,
  nextUpdateDate: null,
  needsUpdate: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('Focus presentation adapters', () => {
  it('maps domain records into primary and contextual receiver contracts', () => {
    expect(focusPrimaryNavigationItems([focus, { ...focus, id: 2, status: 'paused' }])).toEqual([
      {
        id: '1',
        label: 'Project Atlas',
        ariaLabel: 'Project Atlas',
        icon: 'item',
        tone: 'default'
      },
      {
        id: '2',
        label: 'Project Atlas',
        ariaLabel: 'Project Atlas, paused',
        icon: 'paused',
        tone: 'muted'
      }
    ])
    expect(focusContextSidebarItems([thread])).toEqual([
      {
        id: 'overall',
        label: 'Overall',
        icon: 'overview',
        group: { id: 'focus', label: 'Focus' }
      },
      {
        id: 'thread:10',
        label: 'Sprint execution',
        ariaLabel: 'Sprint execution, paused',
        icon: 'paused',
        tone: 'muted',
        group: { id: 'threads', label: 'Threads' }
      }
    ])
    expect(commitmentContextSidebarItems([commitment])).toEqual([
      {
        id: '20',
        label: 'Improve ticket quality',
        lines: 2,
        stateLabel: { label: 'Green', tone: 'success' },
        accessory: 'disclosure'
      }
    ])
  })

  it('maps every model health state into a labeled semantic receiver tone', () => {
    expect(healthStateLabel('red')).toEqual({ label: 'Red', tone: 'danger' })
    expect(healthStateLabel('yellow')).toEqual({ label: 'Yellow', tone: 'warning' })
    expect(healthStateLabel('green')).toEqual({ label: 'Green', tone: 'success' })
    expect(healthStateLabel('none')).toEqual({ label: 'None', tone: 'neutral' })
  })

  it('describes Focus editing in the drawer contract and delegates typed actions', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const adapter = focusDrawerAdapter({ focus, onSave, onDelete })

    expect(adapter).not.toHaveProperty('render')
    expect(adapter.model.sections[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'text', id: 'title', value: 'Project Atlas' }),
        expect.objectContaining({
          kind: 'rich-text',
          id: 'description',
          value: 'Launch notes'
        }),
        expect.objectContaining({ kind: 'select', id: 'status', value: 'active' }),
        expect.objectContaining({ kind: 'static', id: 'kind', value: 'generic' })
      ])
    )

    const save = adapter.model.actions?.find((action) => action.id === 'save')
    const remove = adapter.model.actions?.find((action) => action.id === 'delete')
    await save?.onInvoke({ title: 'Revised', description: '', status: 'paused' })
    await remove?.onInvoke({})

    expect(onSave).toHaveBeenCalledWith({
      title: 'Revised',
      description: null,
      status: 'paused'
    })
    expect(onDelete).toHaveBeenCalledOnce()
    expect(remove?.confirmation?.confirmLabel).toBe('Delete focus')
  })

  it('exposes Commitment facts without exposing UI markup or the domain object', () => {
    const adapter = commitmentDrawerAdapter(commitment, focus.title, ['focus:1'])

    expect(adapter).not.toHaveProperty('render')
    expect(adapter.invalidationKeys).toEqual(['focus:1', 'commitment:20'])
    expect(adapter.model.sections[0]).toEqual({
      id: 'details',
      fields: [
        { kind: 'static', id: 'title', label: 'Title', value: 'Improve ticket quality' },
        { kind: 'static', id: 'parent', label: 'Parent', value: 'Focus — Project Atlas' },
        {
          kind: 'static',
          id: 'status',
          label: 'Status',
          value: 'active',
          capitalization: 'capitalize'
        },
        {
          kind: 'static',
          id: 'state',
          label: 'State',
          value: 'green',
          capitalization: 'capitalize'
        }
      ],
      note: 'No editable settings here yet.'
    })
  })
})
