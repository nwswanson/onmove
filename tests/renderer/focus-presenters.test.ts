import { describe, expect, it, vi } from 'vitest'
import type {
  CommitmentSnapshot,
  FocusScopeSnapshot,
  FocusSnapshot,
  RoutineSnapshot,
  SubjectSnapshot,
  ThreadScopeSnapshot,
  ThreadSnapshot
} from '../../src/shared/contracts'
import {
  archivedThreadItems,
  commitmentCollectionModel,
  commitmentContextSidebarItems,
  commitmentDrawerAdapter,
  commitmentWorkingContextModel,
  dateOrNeverLabel,
  focusContextSidebarItems,
  focusDrawerAdapter,
  focusPrimaryNavigationItems,
  focusScopeEditorModel,
  statusSunflowerModel,
  threadDrawerAdapter,
  threadWorkingContextModel
} from '../../src/renderer/src/features/focus/focus-presenters'
import { buildCommitmentListModel } from '../../src/renderer/src/features/focus/commitment-list-model'
import { healthStateLabel } from '../../src/renderer/src/features/shared/state-presenters'
import {
  WORK_STATUS_OPTIONS,
  workStatusLabel
} from '../../src/renderer/src/features/shared/work-status'

const focus: FocusSnapshot = {
  id: 1,
  kind: 'generic',
  title: 'Project Atlas',
  description: 'Launch notes',
  goal: 'Ship safely',
  status: 'active',
  dueDate: null,
  statusChangedAt: '2026-01-01T00:00:00.000Z',
  lastReviewDate: null,
  needsReview: true,
  sensitive: false,
  notes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const thread: ThreadSnapshot = {
  id: 10,
  focusId: 1,
  title: 'Sprint execution',
  health: 'none',
  status: 'paused',
  dueDate: null,
  reviewFrequencyDays: 7,
  lastReviewDate: null,
  nextReviewDate: '2026-01-08',
  needsReview: false,
  reviewDue: false,
  sensitive: false,
  notes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const commitment: CommitmentSnapshot = {
  id: 20,
  parent: { type: 'focus', id: 1 },
  type: 'tracking',
  title: 'Improve ticket quality',
  status: 'active',
  state: 'green',
  dueDate: null,
  cadenceDays: null,
  reviewFrequencyDays: 7,
  lastReviewDate: '2026-01-07',
  nextReviewDate: '2026-01-14',
  needsReview: true,
  reviewDue: false,
  lastUpdateDate: '2026-01-07',
  nextUpdateDate: null,
  needsUpdate: false,
  sensitive: false,
  notes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const customerOperations: SubjectSnapshot = {
  id: 40,
  kind: 'generic',
  name: 'Customer Operations',
  description: null,
  externalKey: null,
  sensitive: false,
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z'
}

const platformTeam: SubjectSnapshot = {
  ...customerOperations,
  id: 41,
  name: 'Platform Team'
}

describe('Focus presentation adapters', () => {
  it('projects only closed Threads into an alphabetical archive list', () => {
    expect(archivedThreadItems([
      { ...thread, id: 12, title: 'Zeta history', status: 'done', dueDate: '2026-02-01' },
      { ...thread, id: 10, title: 'Current work', status: 'active' },
      {
        ...thread,
        id: 11,
        title: 'Abandoned plan',
        status: 'cancelled',
        lastReviewDate: '2026-01-05'
      }
    ])).toEqual([
      {
        id: 11,
        title: 'Abandoned plan',
        statusLabel: 'Cancelled',
        lastReviewedLabel: '2026-01-05',
        dueDateLabel: null
      },
      {
        id: 12,
        title: 'Zeta history',
        statusLabel: 'Done',
        lastReviewedLabel: 'Never',
        dueDateLabel: '2026-02-01'
      }
    ])
  })

  it('formats missing and effective review dates for every UI receiver', () => {
    expect(dateOrNeverLabel(null)).toBe('Never')
    expect(dateOrNeverLabel('2026-01-06')).toBe('2026-01-06')
  })

  it('translates Focus and Thread applicability into receiver-owned chip models', () => {
    const focusScope: FocusScopeSnapshot = {
      focusId: focus.id,
      mode: 'explicit',
      scopeId: 50,
      subjects: [customerOperations, platformTeam]
    }
    const threadScope: ThreadScopeSnapshot = {
      threadId: thread.id,
      focusId: focus.id,
      mode: 'explicit',
      scopeId: 51,
      subjects: [platformTeam],
      focusSubjects: [customerOperations, platformTeam]
    }
    expect(focusScopeEditorModel(focusScope)).toEqual({
      summary: '2 Subjects in scope',
      subjects: [
        { id: 40, name: 'Customer Operations' },
        { id: 41, name: 'Platform Team' }
      ]
    })
    expect(threadWorkingContextModel(threadScope)).toEqual({
      ariaLabel: 'Thread working context',
      items: [
        {
          id: 'all',
          label: 'All subjects'
        },
        {
          id: 'subject:41',
          label: 'Platform Team',
          accessibleLabel: 'Work in Platform Team',
          stateLabel: { label: 'None', tone: 'neutral' },
          meta: 'Last reviewed · Never',
          attentionLabel: undefined
        }
      ]
    })
    expect(threadWorkingContextModel({
      ...threadScope,
      mode: 'inherited',
      scopeId: null,
      subjects: [],
      focusSubjects: []
    }).items).toEqual([{
      id: 'all',
      label: 'Thread-wide'
    }])

    expect(commitmentWorkingContextModel({
      commitmentId: 20,
      scopeId: 51,
      cells: [{
        scopeId: 51,
        subjectId: platformTeam.id,
        subject: platformTeam,
        state: 'green',
        lastReviewDate: '2026-08-08',
        nextReviewDate: '2026-08-15',
        reviewDue: false,
        lastUpdateDate: '2026-08-08',
        nextUpdateDate: '2026-08-15',
        needsUpdate: true
      }]
    })).toEqual({
      ariaLabel: 'Commitment working context',
      items: [
        { id: 'all', label: 'All subjects' },
        {
          id: `subject:${platformTeam.id}`,
          label: 'Platform Team',
          accessibleLabel: 'Work in Platform Team',
          stateLabel: { label: 'Green', tone: 'success' },
          meta: 'Last updated · 2026-08-08',
          attentionLabel: 'Update due'
        }
      ]
    })
  })

  it('maps domain records into primary and contextual receiver contracts', () => {
    const summary = {
      overallState: 'green' as const,
      activeCommitments: [
        { id: 20, title: 'Red work', state: 'red' as const, sensitive: false, ancestorSensitive: false },
        { id: 21, title: 'Unassessed work', state: 'none' as const, sensitive: false, ancestorSensitive: false }
      ]
    }
    const sunflower = statusSunflowerModel(summary)
    expect(
      focusPrimaryNavigationItems(
        [focus, { ...focus, id: 2, status: 'paused' }],
        { 1: summary }
      )
    ).toEqual([
      {
        id: '1',
        label: 'Project Atlas',
        ariaLabel: 'Project Atlas',
        icon: 'sunflower',
        sunflower,
        tone: 'default',
        dropTarget: { type: 'focus', id: '1' }
      },
      {
        id: '2',
        label: 'Project Atlas',
        ariaLabel: 'Project Atlas, paused',
        icon: 'paused',
        tone: 'muted',
        dropTarget: { type: 'focus', id: '2' }
      }
    ])
    expect(focusContextSidebarItems([{ ...thread, status: 'active' }], { 10: summary })).toEqual([
      {
        id: 'overall',
        label: 'Overall',
        icon: 'overview',
        contextMenu: {
          ariaLabel: 'Overall actions',
          items: [
            {
              kind: 'action',
              id: 'add-commitment',
              label: 'Add commitment',
              icon: 'add'
            },
            {
              kind: 'action',
              id: 'add-routine',
              label: 'Add Routine',
              icon: 'checklist'
            },
            {
              kind: 'checkbox',
              id: 'sensitive',
              label: 'Sensitive',
              icon: 'sensitive',
              checked: false,
              separatorBefore: true
            }
          ]
        },
        group: { id: 'focus', label: 'Focus' }
      },
      {
        id: 'thread:10',
        label: 'Sprint execution',
        ariaLabel: 'Sprint execution',
        icon: 'sunflower',
        sunflower,
        tone: 'default',
        movable: true,
        contextMenu: {
          ariaLabel: 'Sprint execution actions',
          items: [
            {
              kind: 'action',
              id: 'add-commitment',
              label: 'Add commitment',
              icon: 'add'
            },
            {
              kind: 'action',
              id: 'add-routine',
              label: 'Add Routine',
              icon: 'checklist'
            },
            {
              kind: 'checkbox',
              id: 'sensitive',
              label: 'Sensitive',
              icon: 'sensitive',
              checked: false,
              separatorBefore: true
            },
            {
              kind: 'action',
              id: 'delete',
              label: 'Delete Thread',
              icon: 'delete',
              tone: 'destructive',
              separatorBefore: true
            }
          ]
        },
        group: { id: 'threads', label: 'Threads' }
      }
    ])
    expect(commitmentContextSidebarItems([commitment])).toEqual([
      {
        id: '20',
        label: 'Improve ticket quality',
        description: 'Active · Last updated · 2026-01-07',
        group: { id: 'active', label: 'Active' },
        lines: 2,
        stateLabel: { label: 'Green', tone: 'success' },
        accessory: 'disclosure'
      }
    ])
    expect(sunflower).toEqual({
      ariaLabel: 'Overall Green; active commitments: Red work Red, Unassessed work None',
      seeds: [
        { id: 'overall', label: 'Overall: Green', tone: 'success' },
        { id: 'commitment:20', label: 'Red work: Red', tone: 'danger' },
        { id: 'commitment:21', label: 'Unassessed work: None', tone: 'neutral' }
      ]
    })
  })

  it('keeps Thread drop targets alphabetically ordered without sorting Commitments', () => {
    const items = focusContextSidebarItems([
      { ...thread, id: 12, title: 'Team health' },
      { ...thread, id: 11, title: 'Architecture' },
      { ...thread, id: 10, title: 'Sprint execution' }
    ])
    expect(items.map(({ label }) => label)).toEqual([
      'Overall',
      'Architecture',
      'Sprint execution',
      'Team health'
    ])
  })

  it('filters sensitive status signals while drawer adapters retain complete models', () => {
    const sensitiveFocus = { ...focus, sensitive: true }
    const sensitiveThread = { ...thread, sensitive: true }
    const sensitiveCommitment = { ...commitment, sensitive: true }
    const summary = {
      overallState: 'green' as const,
      activeCommitments: [
        {
          id: sensitiveCommitment.id,
          title: sensitiveCommitment.title,
          state: sensitiveCommitment.state,
          sensitive: true,
          ancestorSensitive: false
        },
        {
          id: 21,
          title: 'Nested below sensitive Thread',
          state: 'yellow' as const,
          sensitive: false,
          ancestorSensitive: true
        }
      ]
    }

    expect(focusPrimaryNavigationItems([sensitiveFocus], { 1: summary }, true)[0]).toMatchObject({
      label: sensitiveFocus.title,
      ariaLabel: sensitiveFocus.title
    })
    expect(focusContextSidebarItems([sensitiveThread], { 10: summary }, true)[1]).toMatchObject({
      label: sensitiveThread.title,
      ariaLabel: `${sensitiveThread.title}, paused`
    })
    expect(commitmentContextSidebarItems([sensitiveCommitment])[0]).toMatchObject({
      label: sensitiveCommitment.title
    })
    expect(
      commitmentCollectionModel(buildCommitmentListModel([sensitiveCommitment]))
        .groups[0]?.items[0]
    ).toMatchObject({ title: sensitiveCommitment.title })
    expect(statusSunflowerModel(summary, true).ariaLabel).not.toContain(
      sensitiveCommitment.title
    )
    expect(statusSunflowerModel(summary, true).ariaLabel).not.toContain(
      'Nested below sensitive Thread'
    )
    expect(statusSunflowerModel(summary, true).seeds).toHaveLength(1)

    const focusAdapter = focusDrawerAdapter({
      focus: sensitiveFocus,
      onSave: vi.fn(),
      onDelete: vi.fn()
    })
    expect(focusAdapter.model.description).toBe(sensitiveFocus.title)
    expect(focusAdapter.model.sections[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'text', id: 'title', value: sensitiveFocus.title }),
        expect.objectContaining({
          kind: 'rich-text',
          id: 'description',
          value: sensitiveFocus.description
        })
      ])
    )
  })

  it('maps direct Focus and Thread commitments into nested sidebar collections', () => {
    const focusCommitment = {
      ...commitment,
      title: 'Align sponsors',
      state: 'red' as const
    }
    const threadCommitment = {
      ...commitment,
      id: 21,
      parent: { type: 'thread' as const, id: thread.id },
      title: 'Improve ticket quality',
      state: 'yellow' as const,
      status: 'paused' as const
    }
    const doneFocusCommitment = {
      ...focusCommitment,
      id: 22,
      title: 'Archived sponsor plan',
      status: 'done' as const
    }
    const cancelledThreadCommitment = {
      ...threadCommitment,
      id: 23,
      title: 'Abandoned ticket experiment',
      status: 'cancelled' as const
    }

    const items = focusContextSidebarItems(
      [{ ...thread, status: 'active' }],
      {},
      false,
      {
        overall: [focusCommitment, doneFocusCommitment],
        'thread:10': [threadCommitment, cancelledThreadCommitment]
      }
    )

    expect(items[0]?.childCollection).toEqual({
      id: 'commitments',
      label: 'Commitments and Routines',
      items: [
        {
          id: '20',
          label: 'Align sponsors',
          ariaLabel: 'Open Overall commitment Align sponsors',
          state: { label: 'Red', tone: 'danger' },
          tone: 'default'
        }
      ]
    })
    expect(items[1]?.childCollection).toEqual({
      id: 'commitments',
      label: 'Commitments and Routines',
      items: [
        {
          id: '21',
          label: 'Improve ticket quality',
          ariaLabel: 'Open Sprint execution commitment Improve ticket quality',
          state: { label: 'Yellow', tone: 'warning' },
          tone: 'muted'
        }
      ]
    })
    expect(items[1]?.contextMenu).toEqual({
      ariaLabel: 'Sprint execution actions',
      items: [
        {
          kind: 'action',
          id: 'add-commitment',
          label: 'Add commitment',
          icon: 'add'
        },
        {
          kind: 'action',
          id: 'add-routine',
          label: 'Add Routine',
          icon: 'checklist'
        },
        {
          kind: 'checkbox',
          id: 'sensitive',
          label: 'Sensitive',
          icon: 'sensitive',
          checked: false,
          separatorBefore: true
        },
        {
          kind: 'action',
          id: 'delete',
          label: 'Delete Thread',
          icon: 'delete',
          tone: 'destructive',
          separatorBefore: true
        }
      ]
    })
    expect(
      commitmentContextSidebarItems([
        focusCommitment,
        threadCommitment,
        doneFocusCommitment,
        cancelledThreadCommitment
      ]).map(({ label }) => label)
    ).toEqual(['Align sponsors', 'Improve ticket quality'])
  })

  it('maps every model health state into a labeled semantic receiver tone', () => {
    expect(healthStateLabel('red')).toEqual({ label: 'Red', tone: 'danger' })
    expect(healthStateLabel('yellow')).toEqual({ label: 'Yellow', tone: 'warning' })
    expect(healthStateLabel('green')).toEqual({ label: 'Green', tone: 'success' })
    expect(healthStateLabel('none')).toEqual({ label: 'None', tone: 'neutral' })
  })

  it('projects owned Routines as draggable contextual selections after Commitments', () => {
    const routine = {
      id: 31,
      parent: { type: 'thread', id: thread.id },
      name: 'Weekly evidence inspection',
      status: 'yellow',
      needsAttestation: true
    } as RoutineSnapshot
    const items = focusContextSidebarItems(
      [{ ...thread, status: 'active' }],
      {},
      false,
      { 'thread:10': [commitment] },
      { 'thread:10': [routine] }
    )

    expect(items[1]?.childCollection?.items).toEqual([
      expect.objectContaining({ id: '20', label: 'Improve ticket quality' }),
      {
        id: 'routine:31',
        label: 'Weekly evidence inspection',
        ariaLabel: 'Open Sprint execution Routine Weekly evidence inspection',
        icon: 'checklist',
        state: { label: 'Overdue', tone: 'warning' },
        tone: 'default',
        movable: true
      }
    ])
  })

  it('maps every shared work lifecycle status into the UI label contract', () => {
    expect(WORK_STATUS_OPTIONS).toEqual([
      { value: 'active', label: 'Active', tone: 'primary' },
      { value: 'paused', label: 'Paused', tone: 'neutral' },
      { value: 'done', label: 'Done', tone: 'success' },
      { value: 'cancelled', label: 'Cancelled', tone: 'danger' }
    ])
    expect(workStatusLabel('active')).toEqual(WORK_STATUS_OPTIONS[0])
    expect(workStatusLabel('paused')).toEqual(WORK_STATUS_OPTIONS[1])
    expect(workStatusLabel('done')).toEqual(WORK_STATUS_OPTIONS[2])
    expect(workStatusLabel('cancelled')).toEqual(WORK_STATUS_OPTIONS[3])
  })

  it('maps ordered Commitments into the shared collection receiver contract', () => {
    const action = {
      ...commitment,
      id: 21,
      type: 'tracking' as const,
      title: 'Publish the launch plan',
      state: 'red' as const,
      dueDate: '2026-02-15'
    }
    const closed = {
      ...commitment,
      id: 22,
      title: 'Close the old board',
      status: 'done' as const
    }

    expect(
      commitmentCollectionModel(buildCommitmentListModel([commitment, action, closed]))
    ).toEqual({
      currentCount: 2,
      closedCount: 1,
      groups: [
        {
          id: 'active',
          label: 'Active',
          items: [
            expect.objectContaining({
              id: 21,
              title: 'Publish the launch plan',
              lastUpdatedLabel: '2026-01-07',
              dueDateLabel: '2026-02-15',
              stateLabel: { label: 'Red', tone: 'danger' },
              completion: { visible: true, checked: false, disabled: false }
            }),
            expect.objectContaining({
              id: 20,
              statusLabel: WORK_STATUS_OPTIONS[0],
              completion: { visible: false, checked: false, disabled: true }
            })
          ]
        },
        { id: 'paused', label: 'Paused', items: [] },
        {
          id: 'closed',
          label: 'Done / Cancelled',
          items: [expect.objectContaining({ id: 22, title: 'Close the old board' })]
        }
      ]
    })
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
        expect.objectContaining({ kind: 'static', id: 'kind', value: 'generic' }),
        expect.objectContaining({ kind: 'static', id: 'last-reviewed', value: 'Never' }),
        expect.objectContaining({ kind: 'checkbox', id: 'needs-review', value: true }),
        expect.objectContaining({ kind: 'checkbox', id: 'sensitive', value: false })
      ])
    )

    const save = adapter.model.actions?.find((action) => action.id === 'save')
    const remove = adapter.model.actions?.find((action) => action.id === 'delete')
    await save?.onInvoke({
      title: 'Revised',
      description: '',
      status: 'paused',
      'needs-review': false,
      sensitive: true
    })
    await remove?.onInvoke({})

    expect(onSave).toHaveBeenCalledWith({
      title: 'Revised',
      description: null,
      status: 'paused',
      needsReview: false,
      sensitive: true
    })
    expect(onDelete).toHaveBeenCalledOnce()
    expect(remove?.confirmation?.confirmLabel).toBe('Delete focus')
  })

  it('describes editable Thread details and delegates save and deletion', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const adapter = threadDrawerAdapter({
      thread: { ...thread, lastReviewDate: '2026-01-06', needsReview: true },
      parentTitle: focus.title,
      onSave,
      onDelete
    })

    expect(adapter.model.sections[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'text', id: 'title', value: 'Sprint execution' }),
        expect.objectContaining({
          kind: 'number',
          id: 'review-frequency',
          value: '7',
          min: 1,
          step: 1,
          integer: true
        }),
        expect.objectContaining({ kind: 'static', id: 'last-reviewed', value: '2026-01-06' }),
        expect.objectContaining({ kind: 'checkbox', id: 'needs-review', value: true }),
        expect.objectContaining({ kind: 'checkbox', id: 'sensitive', value: false })
      ])
    )

    const save = adapter.model.actions?.find((action) => action.id === 'save')
    const remove = adapter.model.actions?.find((action) => action.id === 'delete')
    await adapter.model.autosave?.onInvoke({
      title: 'Sprint reliability',
      'review-frequency': '14'
    })
    await save?.onInvoke({
      title: 'Sprint reliability',
      'review-frequency': '14',
      'needs-review': false,
      sensitive: true
    })
    await remove?.onInvoke({})

    expect(onSave).toHaveBeenNthCalledWith(1, {
      title: 'Sprint reliability',
      reviewFrequencyDays: 14
    })
    expect(onSave).toHaveBeenNthCalledWith(2, {
      title: 'Sprint reliability',
      reviewFrequencyDays: 14,
      needsReview: false,
      sensitive: true
    })
    expect(remove?.confirmation?.confirmLabel).toBe('Delete thread')
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('exposes editable Commitment identity without exposing UI markup or the domain object', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const adapter = commitmentDrawerAdapter({
      commitment,
      parentTitle: focus.title,
      ancestorKeys: ['focus:1'],
      onSave,
      onDelete
    })

    expect(adapter).not.toHaveProperty('render')
    expect(adapter.invalidationKeys).toEqual(['focus:1', 'commitment:20'])
    expect(adapter.model.sections[0]).toEqual({
      id: 'details',
      fields: [
        {
          kind: 'text',
          id: 'title',
          label: 'Title',
          value: 'Improve ticket quality',
          required: true
        },
        { kind: 'static', id: 'parent', label: 'Parent', value: 'Focus — Project Atlas' },
        { kind: 'date', id: 'due-date', label: 'Due date', value: '' },
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
        },
        {
          kind: 'static',
          id: 'last-updated',
          label: 'Last updated',
          value: '2026-01-07'
        },
        {
          kind: 'number',
          id: 'review-frequency',
          label: 'Review every (days)',
          value: '7',
          required: true,
          min: 1,
          step: 1,
          integer: true
        },
        {
          kind: 'static',
          id: 'last-reviewed',
          label: 'Last reviewed',
          value: '2026-01-07'
        },
        {
          kind: 'checkbox',
          id: 'needs-review',
          label: 'Needs review',
          value: true,
          description: 'Include this Commitment in review workflows.'
        },
        {
          kind: 'checkbox',
          id: 'sensitive',
          label: 'Sensitive',
          value: false,
          description: 'Hide this Commitment and its Updates from lists.'
        }
      ]
    })
    await adapter.model.autosave?.onInvoke({
      title: 'Improve all ticket quality',
      'due-date': '2026-02-15',
      'review-frequency': '14'
    })
    const save = adapter.model.actions?.find((action) => action.id === 'save')
    await save?.onInvoke({
      title: 'Improve all ticket quality',
      'due-date': '2026-02-15',
      'review-frequency': '14',
      'needs-review': false,
      sensitive: false
    })
    const remove = adapter.model.actions?.find((action) => action.id === 'delete')
    await remove?.onInvoke({})

    expect(onSave).toHaveBeenNthCalledWith(1, {
      title: 'Improve all ticket quality',
      dueDate: '2026-02-15',
      reviewFrequencyDays: 14
    })
    expect(onSave).toHaveBeenNthCalledWith(2, {
      title: 'Improve all ticket quality',
      dueDate: '2026-02-15',
      reviewFrequencyDays: 14,
      needsReview: false,
      sensitive: false
    })
    expect(remove?.confirmation?.confirmLabel).toBe('Delete commitment')
    expect(onDelete).toHaveBeenCalledOnce()
  })

})
