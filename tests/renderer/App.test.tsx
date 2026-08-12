// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppState,
  CommitmentSnapshot,
  DomainApi,
  FocusSnapshot,
  NoteSnapshot,
  OnMoveApi,
  ReviewQueueItemSnapshot,
  RichTextDocumentSnapshot,
  SubjectSnapshot,
  ThreadSnapshot,
  TodoOverviewItemSnapshot,
  TodoParent,
  TodoSnapshot,
  UpdateSnapshot
} from '../../src/shared/contracts'
import { App } from '../../src/renderer/src/App'
import {
  isRichText,
  richTextPlainText
} from '../../src/renderer/src/components/ui/rich-text-editor'
import { clearReviewPrimaryPanePreference } from '../../src/renderer/src/features/review/review-split-preference'
import { clearDueHidePausedPreference } from '../../src/renderer/src/features/due/due-filter-preference'

const initialState: AppState = {
  greeting: 'Hello, world.',
  greetingCount: 0,
  launchCount: 1,
  lastGreetingAt: null,
  databasePath: '/Users/test/Library/Application Support/OnMove/onmove.sqlite3'
}

function focus(overrides: Partial<FocusSnapshot> = {}): FocusSnapshot {
  return {
    id: 1,
    kind: 'generic',
    title: 'Quarterly plan',
    description: null,
    goal: '',
    status: 'active',
    dueDate: null,
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    lastReviewDate: null,
    needsReview: true,
    sensitive: false,
    notes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    nextReviewDate: '2026-01-08',
    needsReview: true,
    reviewDue: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function commitment(overrides: Partial<CommitmentSnapshot> = {}): CommitmentSnapshot {
  return {
    id: 20,
    parent: { type: 'focus', id: 1 },
    type: 'ongoing',
    title: 'Keep sponsors aligned',
    status: 'active',
    state: 'none',
    dueDate: null,
    cadenceDays: null,
    lastReviewDate: null,
    lastUpdateDate: null,
    nextUpdateDate: null,
    needsUpdate: false,
    sensitive: false,
    notes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function note(overrides: Partial<NoteSnapshot> = {}): NoteSnapshot {
  return {
    id: 40,
    parent: { type: 'focus', id: 1 },
    title: 'Default',
    content: 'Existing working notes',
    revision: 0,
    sort: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function update(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    id: 30,
    parent: { type: 'commitment', id: 20 },
    date: '2026-08-01',
    observation: 'Ticket quality is uneven',
    state: 'yellow',
    sensitive: false,
    scope: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function subject(id: number, name: string): SubjectSnapshot {
  return {
    id,
    kind: 'generic',
    name,
    description: null,
    externalKey: null,
    sensitive: false,
    createdAt: '2026-08-08T12:00:00.000Z',
    updatedAt: '2026-08-08T12:00:00.000Z'
  }
}

function todo(overrides: Partial<TodoSnapshot> = {}): TodoSnapshot {
  return {
    id: 70,
    name: 'Review the rollout',
    parent: { type: 'focus', id: 1 },
    subject: null,
    sharedAcrossSubjects: false,
    subjectCompletions: [],
    dueDate: null,
    done: false,
    completedAt: null,
    sort: [],
    createdAt: '2026-08-08T12:00:00.000Z',
    updatedAt: '2026-08-08T12:00:00.000Z',
    ...overrides
  }
}

function overviewTodo(
  overrides: Partial<TodoOverviewItemSnapshot> = {}
): TodoOverviewItemSnapshot {
  return {
    ...todo(),
    focus: { id: 1, title: 'Project Atlas', sensitive: false },
    thread: null,
    commitment: null,
    ...overrides
  }
}

function reviewItem(
  overrides: Partial<ReviewQueueItemSnapshot> = {}
): ReviewQueueItemSnapshot {
  const currentFocus = focus({ id: 1, title: 'Project Atlas' })
  return {
    key: 'focus:1',
    kind: 'focus',
    focus: currentFocus,
    thread: null,
    commitment: null,
    cell: null,
    lastReviewDate: null,
    nextReviewDate: null,
    due: false,
    state: null,
    updates: [],
    commitments: [],
    ...overrides
  }
}

function installApi(
  domainOverrides: Partial<DomainApi> = {},
  apiOverrides: Partial<OnMoveApi> = {}
): OnMoveApi {
  const domain: DomainApi = {
    createRelation: vi.fn(),
    deleteRelation: vi.fn(),
    createItem: vi.fn(),
    getItem: vi.fn(),
    deleteItem: vi.fn(),
    moveItem: vi.fn(),
    setItemRelation: vi.fn(),
    setItemStatus: vi.fn(),
    getItemStatusHistory: vi.fn(),
    listFocuses: vi.fn().mockResolvedValue([]),
    createFocus: vi.fn(),
    updateFocus: vi.fn(),
    pokeFocusReview: vi.fn(),
    setFocusStatus: vi.fn(),
    deleteFocus: vi.fn(),
    getFocusStatusHistory: vi.fn(),
    getFocusScope: vi.fn(async (focusId) => ({
      focusId,
      mode: 'open' as const,
      scopeId: null,
      subjects: []
    })),
    addFocusScopeSubject: vi.fn(),
    removeFocusScopeSubject: vi.fn(),
    getThreadScope: vi.fn(async (threadId) => ({
      threadId,
      focusId: 1,
      mode: 'open' as const,
      scopeId: null,
      subjects: [],
      focusSubjects: []
    })),
    getThreadSubjectMatrix: vi.fn().mockResolvedValue([]),
    customizeThreadScope: vi.fn(),
    addThreadScopeSubject: vi.fn(),
    removeThreadScopeSubject: vi.fn(),
    followFocusThreadScope: vi.fn(),
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn(),
    updateThread: vi.fn(),
    planThreadMove: vi.fn(async (id, focusId) => ({
      threadId: id,
      fromFocusId: focusId,
      toFocusId: focusId,
      sourceScopeMode: 'open' as const,
      sourceScopeId: null,
      targetScopeId: null,
      scopeStrategy: 'follow-destination' as const,
      scopeSubjectAdditions: [],
      ownedRecords: { commitments: 0, updates: 0, todos: 0, notes: 0 },
      requiresConfirmation: false
    })),
    moveThread: vi.fn(),
    pokeThreadReview: vi.fn(),
    deleteThread: vi.fn(),
    listCommitments: vi.fn().mockResolvedValue([]),
    getCommitmentWorkingContext: vi.fn(async (commitmentId) => ({
      commitmentId,
      scopeId: null,
      cells: []
    })),
    createCommitment: vi.fn(),
    updateCommitment: vi.fn(),
    planCommitmentMove: vi.fn(async (id, parent) => ({
      commitmentId: id,
      from: parent,
      to: parent,
      sourceScopeMode: 'open' as const,
      sourceScopeId: null,
      targetScopeId: null,
      scopeSubjectAdditions: [],
      ownedRecords: { updates: 0, todos: 0, notes: 0 },
      requiresConfirmation: false
    })),
    moveCommitment: vi.fn(),
    pokeCommitmentReview: vi.fn(),
    deleteCommitment: vi.fn(),
    listUpdates: vi.fn().mockResolvedValue([]),
    createUpdate: vi.fn(),
    updateUpdate: vi.fn(),
    deleteUpdate: vi.fn(),
    getArchivedUpdateOverview: vi.fn().mockResolvedValue({
      generatedAt: '2026-08-12T12:00:00.000Z',
      retainedSince: '2026-07-13T12:00:00.000Z',
      retentionDays: 30,
      items: []
    }),
    deleteArchivedUpdate: vi.fn(),
    clearArchivedUpdates: vi.fn(),
    listTodos: vi.fn().mockResolvedValue([]),
    queryTodos: vi.fn().mockResolvedValue([]),
    getTodoOverview: vi.fn().mockResolvedValue({
      items: [],
      today: '2026-08-10',
      recentlyCompletedDays: 7,
      completedSince: '2026-08-03T12:00:00.000Z'
    }),
    createTodo: vi.fn(),
    updateTodo: vi.fn(),
    updateTodoSubjectCompletion: vi.fn(),
    reorderTodos: vi.fn(),
    deleteTodo: vi.fn(),
    listNotes: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([]),
    listTagUses: vi.fn().mockResolvedValue([]),
    getNavigationBadgeOverview: vi.fn().mockResolvedValue({
      asOf: '2026-08-10',
      dueThrough: '2026-08-17',
      todos: { total: 0, nonSensitive: 0 },
      review: { total: 0, nonSensitive: 0 },
      due: { total: 0, nonSensitive: 0 }
    }),
    getReviewOverview: vi.fn().mockResolvedValue({
      asOf: '2026-08-10',
      items: []
    }),
    getDueOverview: vi.fn().mockResolvedValue({
      asOf: '2026-08-10',
      items: []
    }),
    ...domainOverrides
  }
  const api: OnMoveApi = {
    getAppState: vi.fn().mockResolvedValue(initialState),
    getSensitiveContentHidden: vi.fn().mockResolvedValue(false),
    onSensitiveContentVisibilityChanged: vi.fn(() => () => undefined),
    onNavigationBadgesInvalidated: vi.fn(() => () => undefined),
    recordGreeting: vi.fn().mockResolvedValue(initialState),
    showDataFolder: vi.fn().mockResolvedValue(undefined),
    backups: {
      getState: vi.fn().mockResolvedValue({
        automatic: true,
        intervalHours: 24,
        retentionLimit: 10,
        directoryPath: '/Users/test/Library/Application Support/OnMove/Backups',
        lastBackupAt: '2026-08-10T12:00:00.000Z',
        nextBackupAt: '2026-08-11T12:00:00.000Z',
        backups: [{
          fileName: 'onmove-backup-20260810T120000000Z-test.sqlite3',
          createdAt: '2026-08-10T12:00:00.000Z',
          sizeBytes: 65_536
        }]
      }),
      createNow: vi.fn().mockResolvedValue({
        automatic: true,
        intervalHours: 24,
        retentionLimit: 10,
        directoryPath: '/Users/test/Library/Application Support/OnMove/Backups',
        lastBackupAt: '2026-08-10T13:00:00.000Z',
        nextBackupAt: '2026-08-11T13:00:00.000Z',
        backups: [{
          fileName: 'onmove-backup-20260810T130000000Z-test.sqlite3',
          createdAt: '2026-08-10T13:00:00.000Z',
          sizeBytes: 65_536
        }]
      }),
      showFolder: vi.fn().mockResolvedValue(undefined)
    },
    domain,
    richText: {
      getDocument: vi.fn(() => new Promise<RichTextDocumentSnapshot>(() => undefined)),
      saveDocument: vi.fn((reference, value) => ({
        reference,
        title: 'Test document',
        contextPath: ['Test document'],
        value,
        revision: 1,
        updatedAt: '2026-01-01T00:00:01.000Z'
      })),
      openWindow: vi.fn().mockResolvedValue(undefined),
      getWindowTarget: vi.fn().mockResolvedValue(null),
      onDocumentChanged: vi.fn(() => () => undefined)
    },
    ...apiOverrides
  }
  Object.defineProperty(window, 'onmove', { value: api, configurable: true })
  return api
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearDueHidePausedPreference()
  })

  it('shows the toolbar and sidebar while SQLite and focuses load', () => {
    installApi({}, { getAppState: vi.fn(() => new Promise<AppState>(() => undefined)) })

    render(<App />)

    expect(screen.getByLabelText('Loading application')).toBeInTheDocument()
    expect(screen.getByLabelText('Primary sidebar')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Application toolbar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New focus' })).toBeDisabled()
  })

  it('starts on Todos with focuses exposed directly beneath the Focuses label', async () => {
    installApi()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Todos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Focuses')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Focus' })).not.toBeInTheDocument()
    expect(screen.getByText('No focuses yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New focus' })).toBeEnabled()
    expect(screen.queryByText('Placeholder')).not.toBeInTheDocument()
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
  })

  it('shows retained Updates read-only and permanently deletes one or all from Archive', async () => {
    const retained = [
      {
        archiveId: 'a'.repeat(32),
        originalUpdateId: 41,
        parent: { type: 'commitment' as const, id: 31 },
        scope: { scopeId: 51, subjectId: 61 },
        date: '2026-08-10',
        observation: 'North region readiness is green.',
        state: 'green' as const,
        sensitive: false,
        effectiveSensitive: false,
        observationRevision: 2,
        createdAt: '2026-08-10T10:00:00.000Z',
        updatedAt: '2026-08-10T11:00:00.000Z',
        context: {
          focusTitle: 'Project Atlas',
          threadTitle: 'Sprint execution',
          commitmentTitle: 'Improve ticket quality',
          subjectName: 'North region'
        },
        deletedAt: '2026-08-12T12:00:00.000Z'
      },
      {
        archiveId: 'b'.repeat(32),
        originalUpdateId: 42,
        parent: { type: 'focus' as const, id: 8 },
        scope: null,
        date: '2026-08-11',
        observation: '',
        state: 'none' as const,
        sensitive: false,
        effectiveSensitive: false,
        observationRevision: 0,
        createdAt: '2026-08-11T10:00:00.000Z',
        updatedAt: '2026-08-11T10:00:00.000Z',
        context: {
          focusTitle: 'Project Beacon',
          threadTitle: null,
          commitmentTitle: null,
          subjectName: null
        },
        deletedAt: '2026-08-12T13:00:00.000Z'
      }
    ]
    const deleteArchivedUpdate = vi.fn().mockResolvedValue(true)
    const clearArchivedUpdates = vi.fn().mockResolvedValue(1)
    installApi({
      getArchivedUpdateOverview: vi.fn().mockResolvedValue({
        generatedAt: '2026-08-12T14:00:00.000Z',
        retainedSince: '2026-07-13T14:00:00.000Z',
        retentionDays: 30,
        items: retained
      }),
      deleteArchivedUpdate,
      clearArchivedUpdates
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Archive' }))
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Archive' })).toBeVisible()
    expect(screen.getByRole('list', { name: 'Archived updates' })).toHaveTextContent(
      'Project Atlas › Sprint execution › Improve ticket quality › North region'
    )
    expect(screen.getByLabelText('Archived update observation from 2026-08-10'))
      .toHaveAttribute('contenteditable', 'false')
    expect(screen.getByText('No observation recorded.')).toBeVisible()
    expect(screen.queryByLabelText('Update date')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', {
      name: /Permanently delete archived update from Project Atlas/
    }))
    expect(screen.getByRole('dialog', { name: 'Delete archived update?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(deleteArchivedUpdate).toHaveBeenCalledWith('a'.repeat(32))
    expect(screen.queryByText('North region readiness is green.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByRole('dialog', { name: 'Clear the archive?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear archive' }))
    expect(clearArchivedUpdates).toHaveBeenCalledOnce()
    expect(screen.getByText('No deleted updates from the last 30 days.')).toBeVisible()
  })

  it('badges actionable primary destinations and refreshes invalidated review counts', async () => {
    let invalidateBadges: (() => void) | undefined
    const getNavigationBadgeOverview = vi.fn()
      .mockResolvedValueOnce({
        asOf: '2026-08-10',
        dueThrough: '2026-08-17',
        todos: { total: 2, nonSensitive: 2 },
        review: { total: 4, nonSensitive: 4 },
        due: { total: 3, nonSensitive: 3 }
      })
      .mockResolvedValue({
        asOf: '2026-08-10',
        dueThrough: '2026-08-17',
        todos: { total: 2, nonSensitive: 2 },
        review: { total: 3, nonSensitive: 3 },
        due: { total: 3, nonSensitive: 3 }
      })
    installApi(
      { getNavigationBadgeOverview },
      {
        onNavigationBadgesInvalidated: vi.fn((listener) => {
          invalidateBadges = listener
          return () => undefined
        })
      }
    )
    render(<App />)

    const todos = await screen.findByRole('button', {
      name: 'Todos, 2 overdue or due today'
    })
    expect(within(todos).getByText('2')).toBeVisible()
    expect(within(screen.getByRole('button', { name: 'Review, 4 remaining' }))
      .getByText('4')).toBeVisible()
    expect(within(screen.getByRole('button', {
      name: 'Due, 3 overdue or due within seven days'
    })).getByText('3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Tags' })).not.toHaveTextContent(/\d/)

    act(() => invalidateBadges?.())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review, 3 remaining' }))
      .toBeVisible())
    expect(getNavigationBadgeOverview).toHaveBeenCalledTimes(2)
  })

  it('operates the global Due worklist and deep-links its hierarchy', async () => {
    const currentFocus = focus({
      id: 5,
      title: 'Project Atlas',
      status: 'active',
      dueDate: '2026-08-10'
    })
    let currentThread = thread({
      id: 15,
      focusId: currentFocus.id,
      title: 'Sprint execution',
      dueDate: '2026-08-09'
    })
    let currentCommitment = commitment({
      id: 25,
      parent: { type: 'thread', id: currentThread.id },
      title: 'Improve ticket quality',
      dueDate: '2026-08-12'
    })
    const dueOverview = () => ({
      asOf: '2026-08-10',
      items: [
        currentFocus.dueDate ? {
          key: `focus:${currentFocus.id}`,
          kind: 'focus' as const,
          focus: currentFocus,
          thread: null,
          commitment: null,
          dueDate: currentFocus.dueDate,
          parent: null
        } : null,
        currentThread.dueDate ? {
          key: `thread:${currentThread.id}`,
          kind: 'thread' as const,
          focus: currentFocus,
          thread: currentThread,
          commitment: null,
          dueDate: currentThread.dueDate,
          parent: {
            kind: 'focus' as const,
            title: currentFocus.title,
            dueDate: currentFocus.dueDate
          }
        } : null,
        currentCommitment.dueDate ? {
          key: `commitment:${currentCommitment.id}`,
          kind: 'commitment' as const,
          focus: currentFocus,
          thread: currentThread,
          commitment: currentCommitment,
          dueDate: currentCommitment.dueDate,
          parent: {
            kind: 'thread' as const,
            title: currentThread.title,
            dueDate: currentThread.dueDate
          }
        } : null
      ].filter((item) => item !== null)
    })
    const updateThread = vi.fn(async (_id: number, input: { dueDate?: string | null }) => {
      currentThread = { ...currentThread, ...input }
      return currentThread
    })
    const updateCommitment = vi.fn(async (
      _id: number,
      input: { status?: CommitmentSnapshot['status'] }
    ) => {
      currentCommitment = { ...currentCommitment, ...input }
      return currentCommitment
    })
    installApi({
      listFocuses: vi.fn(async () => [currentFocus]),
      listThreads: vi.fn(async () => [currentThread]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'thread' ? [currentCommitment] : []),
      getDueOverview: vi.fn(async () => dueOverview()),
      updateThread,
      updateCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Due' }))
    expect(screen.getByRole('button', { name: 'Due' })).toHaveAttribute('aria-current', 'page')
    const table = await screen.findByRole('table', { name: 'Due work' })
    expect(within(table).getByText('Past due')).toBeVisible()
    expect(within(table).getByText('Today')).toBeVisible()
    expect(within(table).getByText('This week')).toBeVisible()
    expect(within(table).getByLabelText(
      'Due date 2026-08-12 is after the parent Thread due date 2026-08-09.'
    )).toBeVisible()

    fireEvent.change(within(table).getByLabelText('Thread due date'), {
      target: { value: '2026-08-11' }
    })
    await waitFor(() => expect(updateThread).toHaveBeenCalledWith(15, {
      dueDate: '2026-08-11'
    }))
    await user.selectOptions(
      within(table).getByLabelText('Commitment Improve ticket quality status'),
      'paused'
    )
    await waitFor(() => expect(updateCommitment).toHaveBeenCalledWith(25, {
      status: 'paused'
    }))

    await user.click(screen.getByLabelText('Hide paused'))
    await waitFor(() => expect(within(table).queryByText('Improve ticket quality'))
      .not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Tags' }))
    await user.click(screen.getByRole('button', { name: 'Due' }))
    expect(screen.getByLabelText('Hide paused')).toBeChecked()
    expect(screen.queryByText('Improve ticket quality')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Hide paused'))

    await user.click(within(await screen.findByRole('table', { name: 'Due work' })).getByRole('link', {
      name: 'Open Commitment Improve ticket quality in Project Atlas › Sprint execution'
    }))
    expect(await screen.findByRole('heading', { name: 'Improve ticket quality' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Project Atlas' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('opens the command palette with Cmd-K and deep-links Commitments and Tags', async () => {
    const project = focus({ id: 5, title: 'Project Atlas' })
    const sprint = thread({ id: 15, focusId: project.id, title: 'Sprint execution' })
    const customerOperations = subject(61, 'Customer Operations')
    const ticketQuality = commitment({
      id: 25,
      parent: { type: 'thread', id: sprint.id },
      title: 'Improve ticket quality'
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([project]),
      listThreads: vi.fn(async (focusId) => focusId === project.id ? [sprint] : []),
      getThreadScope: vi.fn(async (threadId) => ({
        threadId,
        focusId: project.id,
        mode: 'explicit' as const,
        scopeId: 51,
        subjects: [customerOperations],
        focusSubjects: [customerOperations]
      })),
      getThreadSubjectMatrix: vi.fn(async () => [{
        scopeId: 51,
        subjectId: customerOperations.id,
        subject: customerOperations,
        state: 'green' as const,
        lastReviewDate: '2026-08-10',
        nextReviewDate: '2026-08-17',
        reviewDue: false,
        commitments: [{
          scopeId: 51,
          subjectId: customerOperations.id,
          commitmentId: ticketQuality.id,
          state: 'green' as const,
          lastUpdateDate: '2026-08-10',
          nextUpdateDate: null,
          needsUpdate: false
        }]
      }]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'thread' && parent.id === sprint.id ? [ticketQuality] : []),
      getCommitmentWorkingContext: vi.fn(async (commitmentId) => ({
        commitmentId,
        scopeId: 51,
        cells: [{
          scopeId: 51,
          subjectId: customerOperations.id,
          subject: customerOperations,
          state: 'green' as const,
          lastReviewDate: '2026-08-10',
          lastUpdateDate: '2026-08-10',
          nextUpdateDate: null,
          needsUpdate: false
        }]
      })),
      queryTodos: vi.fn().mockResolvedValue([
        todo({
          id: 75,
          parent: { type: 'commitment', id: ticketQuality.id },
          name: 'Confirm launch owner'
        })
      ]),
      listTags: vi.fn().mockResolvedValue([
        { name: 'launch', useCount: 2, sensitiveUseCount: 0 }
      ]),
      listTagUses: vi.fn().mockResolvedValue([])
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Todos' })

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Jump to anything' })
    expect(within(dialog).getByRole('option', { name: /^Project Atlas Focus/ })).toBeVisible()
    expect(within(dialog).getByRole('option', { name: /^Sprint execution/ })).toBeVisible()
    expect(within(dialog).getByRole('option', {
      name: /Improve ticket quality Project Atlas › Sprint execution › All subjects/
    })).toBeVisible()
    expect(within(dialog).getByRole('option', {
      name: /Improve ticket quality Project Atlas › Sprint execution › Customer Operations/
    })).toBeVisible()
    expect(within(dialog).getByRole('option', { name: /^Confirm launch owner/ })).toBeVisible()
    expect(within(dialog).getByRole('option', { name: /^@launch/ })).toBeVisible()

    await user.type(
      within(dialog).getByPlaceholderText(/Search Focuses, Threads, Commitments/),
      'ticket quality'
    )
    await user.click(within(dialog).getByRole('option', {
      name: /Improve ticket quality Project Atlas › Sprint execution › All subjects/
    }))
    expect(await screen.findByRole('heading', {
      name: 'Improve ticket quality'
    })).toBeVisible()
    expect(screen.getByRole('button', {
      name: 'Open Sprint execution commitment Improve ticket quality'
    })).toHaveAttribute('aria-current', 'page')

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const reopened = await screen.findByRole('dialog', { name: 'Jump to anything' })
    await user.type(
      within(reopened).getByPlaceholderText(/Search Focuses, Threads, Commitments/),
      'customer operations'
    )
    await user.click(within(reopened).getByRole('option', {
      name: /Improve ticket quality Project Atlas › Sprint execution › Customer Operations/
    }))

    expect(await screen.findByRole('tab', { name: 'Work in Customer Operations' }))
      .toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const tagsSearch = await screen.findByRole('dialog', { name: 'Jump to anything' })
    await user.type(
      within(tagsSearch).getByPlaceholderText(/Search Focuses, Threads, Commitments/),
      '@launch'
    )
    await user.click(within(tagsSearch).getByRole('option', { name: /^@launch/ }))

    expect(await screen.findByRole('heading', { name: '@launch' })).toBeVisible()
    expect(screen.getByRole('button', { name: '@launch' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('reviews full-width Focus and Thread surfaces without commitment drilldown', async () => {
    const currentFocus = focus({
      id: 4,
      title: 'Project Atlas',
      goal: 'Ship the pilot safely',
      description: 'Coordinate a measured customer rollout.'
    })
    const currentThread = thread({
      id: 14,
      focusId: 4,
      title: 'Sprint execution',
      reviewDue: true,
      nextReviewDate: '2026-08-10'
    })
    const related = commitment({
      id: 24,
      parent: { type: 'thread', id: 14 },
      title: 'Improve ticket quality',
      state: 'yellow'
    })
    let persistedThread = currentThread
    const pokeThreadReview = vi.fn(async () => {
      persistedThread = { ...persistedThread, lastReviewDate: '2026-08-10' }
      return persistedThread
    })
    const getReviewOverview = vi.fn().mockResolvedValue({
      asOf: '2026-08-10',
      items: [
        reviewItem({
          key: 'focus:4',
          focus: currentFocus,
          commitments: [related]
        }),
        reviewItem({
          key: 'thread:14',
          kind: 'thread',
          focus: currentFocus,
          thread: currentThread,
          nextReviewDate: '2026-08-10',
          due: true,
          state: 'yellow',
          commitments: [related]
        })
      ]
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      listThreads: vi.fn(async () => [persistedThread]),
      listCommitments: vi.fn().mockResolvedValue([related]),
      getReviewOverview,
      pokeThreadReview
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Contextual sidebar')).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Focus review: Project Atlas' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Focus type' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Review context' })).toHaveTextContent(
      'PortfolioProject Atlas'
    )
    expect(screen.getByLabelText('Focus description')).toHaveTextContent(
      'Coordinate a measured customer rollout.'
    )
    expect(screen.getByText('Ship the pilot safely')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Related commitments' })).toHaveTextContent(
      'Improve ticket quality'
    )
    expect(screen.queryByRole('button', { name: /Open commitment/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ignore' }))
    expect(screen.getByRole('article', { name: 'Thread review: Sprint execution' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Thread type' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Review context' })).toHaveTextContent(
      'Project AtlasSprint execution'
    )
    await user.click(screen.getByRole('button', { name: 'Pass along' }))
    await waitFor(() => expect(pokeThreadReview).toHaveBeenCalledWith(14))
    expect(await screen.findByRole('heading', { name: 'You’re caught up' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Review again' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review skipped items' }))
    expect(await screen.findByRole('article', { name: 'Focus review: Project Atlas' })).toBeVisible()
    expect(screen.queryByRole('article', {
      name: 'Thread review: Sprint execution'
    })).not.toBeInTheDocument()
    expect(getReviewOverview).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', {
      name: 'Sprint execution'
    }))
    expect(await screen.findByLabelText('Thread last reviewed')).toHaveTextContent(
      'Last reviewed · 2026-08-10'
    )
  })

  it('passes only the selected review Subject cell', async () => {
    const currentFocus = focus({ id: 6, title: 'Regional rollout' })
    const currentThread = thread({
      id: 16,
      focusId: 6,
      title: 'Market health',
      reviewDue: true
    })
    const pokeThreadReview = vi.fn().mockResolvedValue({
      ...currentThread,
      lastReviewDate: '2026-08-10'
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      pokeThreadReview,
      getReviewOverview: vi.fn().mockResolvedValue({
        asOf: '2026-08-10',
        items: [reviewItem({
          key: 'thread:16:scope:56:subject:66',
          kind: 'thread',
          focus: currentFocus,
          thread: currentThread,
          cell: {
            scopeId: 56,
            subjectId: 66,
            subject: subject(66, 'North region')
          },
          due: true
        })]
      })
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(screen.getByText('Subject · North region')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Pass along' }))

    await waitFor(() => expect(pokeThreadReview).toHaveBeenCalledWith(16, {
      scopeId: 56,
      subjectId: 66
    }))
    expect(await screen.findByRole('heading', { name: 'You’re caught up' })).toBeVisible()
  })

  it('keeps the Default note in a resizable lower pane and pokes without advancing', async () => {
    clearReviewPrimaryPanePreference()
    const currentNote = note({ id: 47, parent: { type: 'focus', id: 7 } })
    const currentFocus = focus({
      id: 7,
      title: 'Launch board',
      notes: [currentNote]
    })
    const pokeFocusReview = vi.fn().mockResolvedValue({
      ...currentFocus,
      lastReviewDate: '2026-08-10'
    })
    const api = installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      pokeFocusReview,
      getReviewOverview: vi.fn().mockResolvedValue({
        asOf: '2026-08-10',
        items: [reviewItem({ key: 'focus:7', focus: currentFocus })]
      })
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const reviewArticle = screen.getByRole('article', { name: 'Focus review: Launch board' })
    const notePane = screen.getByRole('region', { name: 'Focus default note' })
    const divider = screen.getByRole('separator', { name: 'Resize review and note panes' })
    expect(reviewArticle).toBeVisible()
    expect(notePane).toBeVisible()
    expect(divider).toHaveAttribute('aria-orientation', 'horizontal')
    expect(divider).toHaveAttribute('aria-valuenow', '62')

    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    expect(divider).toHaveAttribute('aria-valuenow', '67')

    await user.click(screen.getByRole('button', { name: 'Todos' }))
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('separator', {
      name: 'Resize review and note panes'
    })).toHaveAttribute('aria-valuenow', '67')

    const restoredNotePane = screen.getByRole('region', { name: 'Focus default note' })
    const restoredReviewArticle = screen.getByRole('article', {
      name: 'Focus review: Launch board'
    })
    const editor = within(restoredNotePane).getByRole('textbox', { name: 'Default note' })
    await user.click(editor)
    await user.keyboard(' decision')
    await waitFor(() => expect(api.richText.saveDocument).toHaveBeenCalled())
    await waitFor(() => expect(pokeFocusReview).toHaveBeenCalledWith(7))
    expect(pokeFocusReview).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('article', { name: 'Focus review: Launch board' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'You’re caught up' })).not.toBeInTheDocument()
    expect(within(restoredReviewArticle).getByText('2026-08-10', { selector: 'dd' })).toBeVisible()
  })

  it('creates and edits review Todos while poking the current aggregate', async () => {
    const currentFocus = focus({ id: 7, title: 'Launch board' })
    const createdTodo = todo({
      id: 77,
      parent: { type: 'focus', id: currentFocus.id },
      name: 'Confirm launch owner'
    })
    const createTodo = vi.fn().mockResolvedValue(createdTodo)
    const updateTodo = vi.fn().mockImplementation(async (_id, input) => ({
      ...createdTodo,
      ...input,
      updatedAt: '2026-08-10T12:01:00.000Z'
    }))
    const pokeFocusReview = vi.fn().mockResolvedValue({
      ...currentFocus,
      lastReviewDate: '2026-08-10'
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      createTodo,
      updateTodo,
      pokeFocusReview,
      getReviewOverview: vi.fn().mockResolvedValue({
        asOf: '2026-08-10',
        items: [reviewItem({ key: 'focus:7', focus: currentFocus })]
      })
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await user.type(screen.getByRole('textbox', { name: 'New Todo name' }), 'Confirm launch owner')
    await user.click(screen.getByRole('button', { name: 'Add Todo' }))

    await waitFor(() => expect(createTodo).toHaveBeenCalledWith({
      parent: { type: 'focus', id: 7 },
      name: 'Confirm launch owner',
      dueDate: null
    }))
    await waitFor(() => expect(pokeFocusReview).toHaveBeenCalledWith(7))
    expect(screen.getByRole('article', { name: 'Focus review: Launch board' })).toBeVisible()
    expect(screen.getByText('2026-08-10', { selector: 'dd' })).toBeVisible()

    const name = screen.getByRole('textbox', { name: 'Todo name' })
    await user.clear(name)
    await user.type(name, 'Confirm launch DRI')
    await user.tab()

    await waitFor(() => expect(updateTodo).toHaveBeenCalledWith(77, {
      name: 'Confirm launch DRI'
    }))
    await waitFor(() => expect(pokeFocusReview).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('article', { name: 'Focus review: Launch board' })).toBeVisible()
  })

  it('chooses an exact review Subject target and persists only after Add', async () => {
    const currentFocus = focus({ id: 5, title: 'People program' })
    const currentThread = thread({ id: 15, focusId: 5, title: 'Team health', reviewDue: true })
    const currentCommitment = commitment({
      id: 25,
      parent: { type: 'thread', id: 15 },
      title: 'Hold weekly check-ins',
      cadenceDays: 7,
      needsUpdate: true
    })
    const created = update({
      id: 35,
      parent: { type: 'commitment', id: 25 },
      date: '2026-08-10',
      observation: 'Initial draft',
      state: 'none',
      scope: { scopeId: 51, subjectId: 61 }
    })
    const createUpdate = vi.fn(async (input) => ({ ...created, ...input }))
    const getReviewOverview = vi.fn().mockResolvedValue({
      asOf: '2026-08-10',
      items: [reviewItem({
        key: 'commitment:25:scope:51:subject:61',
        kind: 'commitment',
        focus: currentFocus,
        thread: currentThread,
        commitment: currentCommitment,
        cell: { scopeId: 51, subjectId: 61, subject: subject(61, 'Customer Operations') },
        lastReviewDate: null,
        nextReviewDate: '2026-08-10',
        due: true,
        state: 'none'
      })]
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      listThreads: vi.fn(async (focusId) => focusId === currentFocus.id ? [currentThread] : []),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'thread' && parent.id === currentThread.id ? [currentCommitment] : []),
      getThreadScope: vi.fn(async () => ({
        threadId: currentThread.id,
        focusId: currentFocus.id,
        mode: 'explicit' as const,
        scopeId: 51,
        subjects: [subject(61, 'Customer Operations')],
        focusSubjects: []
      })),
      getCommitmentWorkingContext: vi.fn(async () => ({
        commitmentId: currentCommitment.id,
        scopeId: 51,
        cells: [{
          scopeId: 51,
          subjectId: 61,
          subject: subject(61, 'Customer Operations'),
          state: 'none' as const,
          lastReviewDate: null,
          lastUpdateDate: null,
          nextUpdateDate: '2026-08-10',
          needsUpdate: true
        }]
      })),
      getReviewOverview,
      createUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(screen.getByText('Subject · Customer Operations')).toBeVisible()
    const shortcut = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true
    })
    document.dispatchEvent(shortcut)
    expect(shortcut.defaultPrevented).toBe(true)
    const chooser = await screen.findByRole('dialog', { name: 'Choose update target' })
    expect(createUpdate).not.toHaveBeenCalled()
    await user.type(within(chooser).getByPlaceholderText(/Filter Focuses, Threads/), 'weekly')
    await user.click(within(chooser).getByRole('option', { name: /^Hold weekly check-ins/ }))

    let composer = await screen.findByRole('dialog', { name: 'Add update' })
    expect(composer).toHaveClass('max-w-3xl')
    expect(composer).toHaveTextContent(
      'Hold weekly check-ins · People program › Team health › Customer Operations'
    )
    expect(
      within(composer).getByRole('textbox', { name: 'Update observation' })
        .closest('[data-slot="rich-text-editor"]')
    ).toHaveClass('min-h-64')
    expect(within(composer).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
    expect(within(composer).queryByRole('button', {
      name: 'Open Update observation in new window'
    })).not.toBeInTheDocument()
    await user.click(within(composer).getByRole('button', { name: 'Cancel' }))
    expect(createUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('article', {
      name: 'Commitment review: Hold weekly check-ins'
    })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Update' }))
    const reopenedChooser = await screen.findByRole('dialog', { name: 'Choose update target' })
    await user.click(within(reopenedChooser).getByRole('option', {
      name: /^Hold weekly check-ins/
    }))
    composer = await screen.findByRole('dialog', { name: 'Add update' })
    fireEvent.change(within(composer).getByLabelText('Date'), {
      target: { value: '2026-08-11' }
    })
    await user.selectOptions(within(composer).getByLabelText('Update state'), 'red')
    await user.click(within(composer).getByRole('checkbox', { name: 'Sensitive' }))
    const observation = within(composer).getByRole('textbox', { name: 'Update observation' })
    await user.click(observation)
    await user.paste('Customer sentiment improved')
    expect(observation).toHaveTextContent('Customer sentiment improved')
    expect(createUpdate).not.toHaveBeenCalled()
    await user.click(within(composer).getByRole('button', { name: 'Add update' }))

    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    const input = createUpdate.mock.calls[0][0]
    expect(input).toMatchObject({
      parent: { type: 'commitment', id: 25 },
      date: '2026-08-11',
      state: 'red',
      sensitive: true,
      scope: { scopeId: 51, subjectId: 61 }
    })
    expect(isRichText(input.observation)).toBe(true)
    expect(richTextPlainText(input.observation)).toBe('Customer sentiment improved')
    expect(await screen.findByRole('heading', { name: 'You’re caught up' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('heading', { name: 'You’re caught up' })).toBeVisible()
    expect(screen.queryByText('Hold weekly check-ins')).not.toBeInTheDocument()
    expect(getReviewOverview).toHaveBeenCalledTimes(2)
  })

  it('opens Cmd-P from every primary workspace except Settings', async () => {
    const currentFocus = focus({ id: 8, title: 'Global update target' })
    const createUpdate = vi.fn()
    installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      createUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    async function expectUpdateCommand(): Promise<void> {
      const shortcut = new KeyboardEvent('keydown', {
        key: 'p',
        metaKey: true,
        bubbles: true,
        cancelable: true
      })
      document.dispatchEvent(shortcut)
      expect(shortcut.defaultPrevented).toBe(true)
      const chooser = await screen.findByRole('dialog', { name: 'Choose update target' })
      expect(await within(chooser).findByRole('option', {
        name: /^Global update target/
      })).toBeVisible()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog', {
        name: 'Choose update target'
      })).not.toBeInTheDocument())
    }

    await screen.findByRole('heading', { name: 'Todos' })
    await expectUpdateCommand()

    await user.click(screen.getByRole('button', { name: 'Tags' }))
    await screen.findByRole('heading', { name: 'Tags' })
    await expectUpdateCommand()

    await user.click(screen.getByRole('button', { name: /Due/ }))
    await screen.findByRole('heading', { name: 'Due' })
    await expectUpdateCommand()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByRole('heading', { name: 'Settings' })
    const settingsShortcut = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true
    })
    document.dispatchEvent(settingsShortcut)

    expect(settingsShortcut.defaultPrevented).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Choose update target' })).not.toBeInTheDocument()
    expect(createUpdate).not.toHaveBeenCalled()
  })

  it('lists Tags in the contextual sidebar and opens each use in its containing screen', async () => {
    const current = focus({ id: 4, title: 'Project @Atlas' })
    const listTagUses = vi.fn().mockResolvedValue([{
      id: 'focus:4:goal:launch',
      name: 'launch',
      source: { type: 'focus' as const, id: 4, field: 'goal' as const },
      context: {
        focus: { id: 4, title: 'Project @Atlas', sensitive: false },
        thread: null,
        commitment: null,
        subject: null
      },
      snippet: 'Coordinate the @Launch review without serialized editor data',
      effectiveSensitive: false
    }])
    const api = installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listTags: vi.fn().mockResolvedValue([
        { name: 'launch', useCount: 1, sensitiveUseCount: 0 },
        { name: 'private', useCount: 1, sensitiveUseCount: 1 }
      ]),
      listTagUses
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Tags' }))
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Contextual sidebar')).toBeVisible()
    expect(await screen.findByRole('button', { name: '@launch' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('button', { name: '@private' })).toBeVisible()
    const table = await screen.findByRole('table', { name: 'Uses of @launch' })
    expect(table).toHaveTextContent('Coordinate the @Launch review without serialized editor data')
    expect(within(table).getByText('@Launch')).toHaveAttribute('data-text-tag', 'true')
    expect(listTagUses).toHaveBeenCalledWith('launch')

    await user.click(within(table).getByRole('link', { name: /Project @Atlas/ }))
    expect(await screen.findByRole('heading', { name: 'Project @Atlas' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(api.domain.listThreads).toHaveBeenCalledWith(4)
  })

  it('sorts the global Todo table, reveals recent closures, and closes open work', async () => {
    const atlasTodo = overviewTodo({
      id: 70,
      name: 'Prepare launch review',
      dueDate: '2026-08-09',
      focus: { id: 2, title: 'Project Atlas', sensitive: false }
    })
    const beaconTodo = overviewTodo({
      id: 71,
      name: 'Call executive sponsor',
      dueDate: null,
      focus: { id: 3, title: 'Project Beacon', sensitive: false }
    })
    const recentlyCompleted = overviewTodo({
      id: 72,
      name: 'Archive decision log',
      done: true,
      completedAt: '2026-08-09T12:00:00.000Z',
      focus: { id: 3, title: 'Project Beacon', sensitive: false }
    })
    const updateTodo = vi.fn(async (id: number) => ({
      ...atlasTodo,
      id,
      done: true,
      completedAt: '2026-08-10T12:00:00.000Z'
    }))
    const getTodoOverview = vi.fn().mockResolvedValue({
      items: [beaconTodo, recentlyCompleted, atlasTodo],
      today: '2026-08-10',
      recentlyCompletedDays: 7,
      completedSince: '2026-08-03T12:00:00.000Z'
    })
    const api = installApi({ getTodoOverview, updateTodo })
    const user = userEvent.setup()
    render(<App />)

    const table = await screen.findByRole('table', { name: 'All Todos' })
    expect(getTodoOverview).toHaveBeenCalledOnce()
    expect(within(table).getByText('Prepare launch review')).toBeVisible()
    expect(within(table).getByText('Overdue')).toBeVisible()
    expect(within(table).queryByText('Archive decision log')).not.toBeInTheDocument()

    await user.click(within(table).getByRole('button', { name: 'Sort by Project' }))
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Project Atlas')
    const showCompleted = screen.getByLabelText('Show completed from last 7 days')
    await user.click(showCompleted)
    expect(within(table).getByText('Archive decision log')).toBeVisible()
    await user.click(showCompleted)

    await user.click(within(table).getByLabelText('Mark Prepare launch review done'))
    expect(api.domain.updateTodo).toHaveBeenCalledWith(70, { done: true })
    await waitFor(() => {
      expect(within(table).queryByText('Prepare launch review')).not.toBeInTheDocument()
    })
  })

  it('opens a unified Todo context link at its Focus, sidebar route, and Subject tab', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const customer = subject(40, 'Customer Operations')
    const scopedCommitment = commitment({
      id: 21,
      parent: { type: 'thread', id: sprint.id },
      title: 'Improve ticket quality'
    })
    const scopedTodo = overviewTodo({
      id: 73,
      name: 'Review customer tickets',
      parent: {
        type: 'commitment-scope',
        id: scopedCommitment.id,
        scope: { scopeId: 50, subjectId: customer.id }
      },
      focus: { id: current.id, title: current.title, sensitive: false },
      thread: { id: sprint.id, title: sprint.title, sensitive: false },
      commitment: {
        id: scopedCommitment.id,
        title: scopedCommitment.title,
        sensitive: false
      },
      subject: customer
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'thread' ? [scopedCommitment] : []
      ),
      getThreadScope: vi.fn().mockResolvedValue({
        threadId: sprint.id,
        focusId: current.id,
        mode: 'custom' as const,
        scopeId: 50,
        subjects: [customer],
        focusSubjects: []
      }),
      getThreadSubjectMatrix: vi.fn().mockResolvedValue([{
        scopeId: 50,
        subjectId: customer.id,
        subject: customer,
        state: 'none' as const,
        lastReviewDate: null,
        nextReviewDate: '2026-08-17',
        reviewDue: false,
        commitments: [{
          commitmentId: scopedCommitment.id,
          scopeId: 50,
          subjectId: customer.id,
          state: 'none' as const,
          lastUpdateDate: null,
          nextUpdateDate: null,
          needsUpdate: false
        }]
      }]),
      getCommitmentWorkingContext: vi.fn().mockResolvedValue({
        commitmentId: scopedCommitment.id,
        scopeId: 50,
        cells: [{
          scopeId: 50,
          subjectId: customer.id,
          subject: customer,
          state: 'none' as const,
          lastReviewDate: null,
          lastUpdateDate: null,
          nextUpdateDate: null,
          needsUpdate: false
        }]
      }),
      getTodoOverview: vi.fn().mockResolvedValue({
        items: [scopedTodo],
        today: '2026-08-10',
        recentlyCompletedDays: 7,
        completedSince: '2026-08-03T12:00:00.000Z'
      })
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('link', {
      name: 'Sprint execution › Improve ticket quality › Customer Operations'
    }))

    expect(await screen.findByRole('heading', { name: 'Improve ticket quality' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Project Atlas' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('button', {
      name: 'Open Sprint execution commitment Improve ticket quality'
    })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('tab', { name: 'Work in Customer Operations' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('expands and completes shared Todo Subjects from the global parent row', async () => {
    const customer = subject(40, 'Customer Operations')
    const platform = subject(41, 'Platform Team')
    const sharedTodo = overviewTodo({
      id: 74,
      name: 'Confirm rollout',
      parent: { type: 'thread', id: 10 },
      thread: { id: 10, title: 'Sprint execution', sensitive: false },
      sharedAcrossSubjects: true,
      subjectCompletions: [customer, platform].map((completionSubject) => ({
        subject: completionSubject,
        done: false,
        completedAt: null,
        createdAt: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z'
      }))
    })
    const updateTodoSubjectCompletion = vi.fn(async (
      _id: number,
      subjectId: number,
      done: boolean
    ) => ({
      ...sharedTodo,
      subjectCompletions: sharedTodo.subjectCompletions.map((completion) =>
        completion.subject.id === subjectId ? { ...completion, done } : completion
      )
    }))
    installApi({
      getTodoOverview: vi.fn().mockResolvedValue({
        items: [sharedTodo],
        today: '2026-08-10',
        recentlyCompletedDays: 7,
        completedSince: '2026-08-03T12:00:00.000Z'
      }),
      updateTodoSubjectCompletion
    })
    const user = userEvent.setup()
    render(<App />)

    const table = await screen.findByRole('table', { name: 'All Todos' })
    expect(within(table).queryByLabelText('Mark Confirm rollout done')).not.toBeInTheDocument()
    await user.click(within(table).getByRole('button', {
      name: 'Show Confirm rollout Subject progress'
    }))
    const progress = within(table).getByRole('list', {
      name: 'Confirm rollout Subject progress'
    })
    await user.click(within(progress).getByLabelText(
      'Mark Confirm rollout done for Customer Operations'
    ))
    expect(updateTodoSubjectCompletion).toHaveBeenCalledWith(74, customer.id, true)
    expect(within(table).getByText('1/2 subjects')).toBeVisible()
  })

  it('returns Todos and removes a sensitive Focus branch when hiding is enabled', async () => {
    const privateFocus = focus({
      title: 'Confidential initiative',
      description: 'Private launch notes',
      goal: 'Acquire the target company',
      sensitive: true
    })
    let visibilityListener: ((hidden: boolean) => void) | undefined
    const api = installApi(
      {
        listFocuses: vi.fn().mockResolvedValue([privateFocus])
      },
      {
        getSensitiveContentHidden: vi.fn().mockResolvedValue(false),
        onSensitiveContentVisibilityChanged: vi.fn((listener) => {
          visibilityListener = listener
          return () => undefined
        })
      }
    )
    const user = userEvent.setup()
    render(<App />)

    await user.click(
      await screen.findByRole('button', { name: 'Confidential initiative' })
    )
    expect(await screen.findByRole('heading', { name: 'Confidential initiative' })).toBeVisible()
    expect(screen.getByText('Private launch notes')).toBeVisible()
    expect(screen.getByText('Acquire the target company')).toBeVisible()
    expect(api.getSensitiveContentHidden).toHaveBeenCalledOnce()

    act(() => visibilityListener?.(true))

    expect(await screen.findByRole('heading', { name: 'Todos' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Confidential initiative' })).not.toBeInTheDocument()
    expect(screen.queryByText('Private launch notes')).not.toBeInTheDocument()

    act(() => visibilityListener?.(false))
    expect(await screen.findByRole('button', { name: 'Confidential initiative' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Todos' })).toBeVisible()
  })

  it('removes sensitive-only Tags and reconciles contextual selection when visibility changes', async () => {
    let visibilityListener: ((hidden: boolean) => void) | undefined
    const listTagUses = vi.fn(async (name: string) => [{
      id: `focus:1:goal:${name}`,
      name,
      source: { type: 'focus' as const, id: 1, field: 'goal' as const },
      context: {
        focus: { id: 1, title: 'Project Atlas', sensitive: name === 'private' },
        thread: null,
        commitment: null,
        subject: null
      },
      snippet: `Review @${name}`,
      effectiveSensitive: name === 'private'
    }])
    installApi(
      {
        listTags: vi.fn().mockResolvedValue([
          { name: 'public', useCount: 1, sensitiveUseCount: 0 },
          { name: 'private', useCount: 1, sensitiveUseCount: 1 }
        ]),
        listTagUses
      },
      {
        onSensitiveContentVisibilityChanged: vi.fn((listener) => {
          visibilityListener = listener
          return () => undefined
        })
      }
    )
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Tags' }))
    await user.click(await screen.findByRole('button', { name: '@private' }))
    expect(await screen.findByRole('table', { name: 'Uses of @private' })).toBeVisible()

    act(() => visibilityListener?.(true))

    expect(screen.queryByRole('button', { name: '@private' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '@public' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(await screen.findByRole('table', { name: 'Uses of @public' })).toBeVisible()
  })

  it('filters sensitive descendants and walks a hidden Commitment route to its visible parent', async () => {
    const current = focus({ title: 'Visible focus' })
    const privateThread = thread({ title: 'Private thread', sensitive: true })
    const nestedPublicCommitment = commitment({
      id: 22,
      parent: { type: 'thread', id: privateThread.id },
      title: 'Public child under private thread'
    })
    const privateCommitment = commitment({
      id: 20,
      title: 'Private direct commitment',
      sensitive: true
    })
    const publicCommitment = commitment({ id: 21, title: 'Public direct commitment' })
    const privateUpdate = update({
      id: 30,
      parent: { type: 'focus', id: current.id },
      observation: 'Private direct update',
      sensitive: true
    })
    const publicUpdate = update({
      id: 31,
      parent: { type: 'focus', id: current.id },
      observation: 'Public direct update'
    })
    let visibilityListener: ((hidden: boolean) => void) | undefined
    installApi(
      {
        listFocuses: vi.fn().mockResolvedValue([current]),
        listThreads: vi.fn().mockResolvedValue([privateThread]),
        listCommitments: vi.fn(async (parent) =>
          parent.type === 'focus'
            ? [privateCommitment, publicCommitment]
            : [nestedPublicCommitment]
        ),
        listUpdates: vi.fn(async (parent) =>
          parent.type === 'focus' ? [privateUpdate, publicUpdate] : []
        ),
        updateUpdate: vi.fn(async (id, input) => ({
          ...(id === privateUpdate.id ? privateUpdate : publicUpdate),
          ...input
        }))
      },
      {
        onSensitiveContentVisibilityChanged: vi.fn((listener) => {
          visibilityListener = listener
          return () => undefined
        })
      }
    )
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Visible focus' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'Open commitment Private direct commitment'
      })
    )
    expect(
      await screen.findByRole('heading', { name: 'Private direct commitment' })
    ).toBeVisible()

    act(() => visibilityListener?.(true))

    expect(await screen.findByRole('heading', { name: 'Visible focus' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.queryByRole('button', { name: 'Private thread' })).not.toBeInTheDocument()
    expect(screen.queryByText('Private direct commitment')).not.toBeInTheDocument()
    expect(screen.queryByText('Public child under private thread')).not.toBeInTheDocument()
    expect(screen.queryByText('Private direct update')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Current commitments' })).getByText(
        'Public direct commitment'
      )
    ).toBeVisible()
    expect(screen.getByText('Public direct update')).toBeVisible()
    expect(
      screen.queryByRole('img', { name: /Public child under private thread/ })
    ).not.toBeInTheDocument()

    act(() => visibilityListener?.(false))
    await user.click(await screen.findByRole('button', { name: 'Private thread' }))
    expect(await screen.findByRole('heading', { name: 'Private thread' })).toBeVisible()

    act(() => visibilityListener?.(true))
    expect(await screen.findByRole('heading', { name: 'Visible focus' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('materializes Focus and Thread sidebar Sunflowers from direct Updates and active Commitments', async () => {
    const current = focus()
    const sprint = thread()
    const focusRisk = commitment({ id: 20, title: 'Focus risk', state: 'red' })
    const threadWork = commitment({
      id: 21,
      parent: { type: 'thread', id: sprint.id },
      title: 'Thread work',
      state: 'green'
    })
    const pausedWork = commitment({
      id: 22,
      parent: { type: 'thread', id: sprint.id },
      title: 'Paused work',
      status: 'paused',
      state: 'red'
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [focusRisk] : [threadWork, pausedWork]
      ),
      listUpdates: vi.fn(async (parent) => [
        update({
          parent,
          date: parent.type === 'focus' ? '2026-08-08' : '2026-08-09',
          state: parent.type === 'focus' ? 'yellow' : 'green'
        })
      ])
    })
    const user = userEvent.setup()
    render(<App />)

    const focusButton = await screen.findByRole('button', { name: 'Quarterly plan' })
    const focusSunflower = await within(focusButton).findByRole('img', {
      name: 'Overall Yellow; active commitments: Focus risk Red, Thread work Green'
    })
    expect(focusSunflower).toHaveAttribute('width', '24')
    expect(focusSunflower.querySelectorAll('[data-seed-index]')).toHaveLength(3)
    expect(focusSunflower.querySelector('[data-seed-index="0"]')).toHaveAttribute(
      'fill',
      'var(--warning)'
    )
    expect(focusSunflower.querySelector('[data-seed-index="1"]')).toHaveAttribute(
      'fill',
      'var(--destructive)'
    )
    expect(focusSunflower.querySelector('[data-seed-index="2"]')).toHaveAttribute(
      'fill',
      'var(--success)'
    )
    expect(focusButton.querySelector('.lucide-circle')).not.toBeInTheDocument()

    await user.click(focusButton)
    const threadButton = await screen.findByRole('button', { name: 'Sprint execution' })
    const threadSunflower = await within(threadButton).findByRole('img', {
      name: 'Overall Green; active commitments: Thread work Green'
    })
    expect(threadSunflower.querySelectorAll('[data-seed-index]')).toHaveLength(2)
    expect(threadButton.querySelector('.lucide-circle')).not.toBeInTheDocument()
  })

  it('creates and selects a persisted focus through the required-title modal', async () => {
    const created = focus({ id: 7, title: 'Launch focus' })
    const createFocus = vi.fn().mockResolvedValue(created)
    installApi({ createFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'New focus' }))
    expect(screen.getByRole('dialog', { name: 'New focus' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create focus' })).toBeDisabled()

    await user.type(screen.getByLabelText(/^Title/), 'Launch focus')
    await user.click(screen.getByRole('button', { name: 'Create focus' }))

    expect(createFocus).toHaveBeenCalledWith({
      title: 'Launch focus',
      description: null
    })
    expect(await screen.findByRole('heading', { name: 'Launch focus' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Launch focus' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('allows duplicate titles, grays paused focuses, and hides cancelled or done focuses', async () => {
    const focuses = [
      focus({ id: 1, title: 'Same title' }),
      focus({ id: 2, title: 'Same title' }),
      focus({ id: 3, title: 'Paused focus', status: 'paused' }),
      focus({ id: 4, title: 'Cancelled focus', status: 'cancelled' }),
      focus({ id: 5, title: 'Done focus', status: 'done' })
    ]
    installApi({ listFocuses: vi.fn().mockResolvedValue(focuses) })
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Todos' })
    const duplicates = screen.getAllByRole('button', { name: 'Same title' })
    expect(duplicates).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Paused focus, paused' })).toHaveClass('opacity-55')
    expect(screen.queryByRole('button', { name: 'Cancelled focus' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done focus' })).not.toBeInTheDocument()

    await user.click(duplicates[1])
    expect(duplicates[1]).toHaveAttribute('aria-current', 'page')
  })

  it('shows Overall and persisted Threads in the contextual sidebar and creates a thread', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const teamHealth = thread({ id: 11, title: 'Team health', reviewFrequencyDays: 14 })
    const createThread = vi.fn().mockResolvedValue(teamHealth)
    const listThreads = vi.fn().mockResolvedValue([sprint])
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads,
      createThread
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    expect(await screen.findByRole('button', { name: 'Sprint execution' })).toBeInTheDocument()
    expect(listThreads).toHaveBeenCalledWith(1)
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      screen.getByText('Threads', { selector: '[data-slot="sidebar-group-label"]' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Contextual sidebar')).toHaveStyle({ width: '252px' })
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize contextual sidebar' }), {
      key: 'ArrowRight'
    })
    expect(screen.getByLabelText('Contextual sidebar')).toHaveStyle({ width: '268px' })

    await user.click(screen.getByRole('button', { name: 'New thread' }))
    expect(screen.getByRole('dialog', { name: 'New thread' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Title/), 'Team health')
    const frequency = screen.getByLabelText('Review every (days)')
    await user.clear(frequency)
    await user.type(frequency, '14')
    await user.click(screen.getByRole('button', { name: 'Create thread' }))

    expect(createThread).toHaveBeenCalledWith({
      focusId: 1,
      title: 'Team health',
      reviewFrequencyDays: 14
    })
    await user.click(await screen.findByRole('button', { name: 'Team health' }))
    expect(screen.getByRole('heading', { name: 'Team health' })).toBeInTheDocument()
  })

  it('uses one shared lifecycle selector on Focus and Thread detail screens', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const updateFocus = vi.fn().mockResolvedValue(
      focus({ title: 'Project Atlas', status: 'paused' })
    )
    const updateThread = vi.fn().mockResolvedValue(
      thread({ status: 'paused' })
    )
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      updateFocus,
      updateThread
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    const focusStatus = screen.getByRole('combobox', { name: 'Focus status' })
    expect(focusStatus).toHaveValue('active')
    await user.selectOptions(focusStatus, 'paused')
    expect(updateFocus).toHaveBeenCalledWith(1, { status: 'paused' })
    expect(await screen.findByRole('combobox', { name: 'Focus status' })).toHaveValue('paused')

    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    const threadStatus = screen.getByRole('combobox', { name: 'Thread status' })
    expect(threadStatus).toHaveValue('active')
    await user.selectOptions(threadStatus, 'paused')
    expect(updateThread).toHaveBeenCalledWith(10, { status: 'paused' })
    expect(screen.getByRole('combobox', { name: 'Thread status' })).toHaveValue('paused')
    expect(screen.getByRole('button', { name: 'Sprint execution, paused' })).toHaveClass(
      'opacity-55'
    )
  })

  it('edits and clears hierarchical due dates while warning when children exceed parents', async () => {
    let currentFocus = focus({ title: 'Project Atlas', dueDate: '2026-09-15' })
    let currentThread = thread({ dueDate: '2026-09-20' })
    let currentCommitment = commitment({
      parent: { type: 'thread', id: currentThread.id },
      dueDate: '2026-09-25',
      type: 'action'
    })
    const updateFocus = vi.fn(async (_id: number, input: Parameters<DomainApi['updateFocus']>[1]) => {
      currentFocus = focus({ ...currentFocus, ...input })
      return currentFocus
    })
    const updateThread = vi.fn(async (_id: number, input: Parameters<DomainApi['updateThread']>[1]) => {
      currentThread = thread({ ...currentThread, ...input })
      return currentThread
    })
    const updateCommitment = vi.fn(async (
      _id: number,
      input: Parameters<DomainApi['updateCommitment']>[1]
    ) => {
      currentCommitment = commitment({ ...currentCommitment, ...input })
      return currentCommitment
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      listThreads: vi.fn().mockResolvedValue([currentThread]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'thread' ? [currentCommitment] : []
      ),
      updateFocus,
      updateThread,
      updateCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    const focusDueDate = screen.getByLabelText('Focus due date')
    expect(focusDueDate).toHaveValue('2026-09-15')
    await user.click(screen.getByRole('button', { name: 'Clear Focus due date' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Focus due date')).toHaveValue('')
      expect(screen.getByLabelText('Focus due date')).not.toBeDisabled()
    })
    expect(updateFocus).toHaveBeenCalledWith(currentFocus.id, { dueDate: null })
    const clearedFocusDueDate = screen.getByLabelText('Focus due date')
    fireEvent.change(clearedFocusDueDate, { target: { value: '2026-09-10' } })
    await waitFor(() => expect(screen.getByLabelText('Focus due date')).toHaveValue('2026-09-10'))
    expect(updateFocus).toHaveBeenLastCalledWith(currentFocus.id, { dueDate: '2026-09-10' })

    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    expect(screen.getByLabelText(
      'Due date 2026-09-20 is after the parent Focus due date 2026-09-10.'
    )).toHaveAttribute('title')
    await user.click(screen.getByRole('button', { name: 'Clear Thread due date' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Thread due date')).toHaveValue('')
      expect(screen.getByLabelText('Thread due date')).not.toBeDisabled()
    })
    expect(updateThread).toHaveBeenCalledWith(currentThread.id, { dueDate: null })
    fireEvent.change(screen.getByLabelText('Thread due date'), {
      target: { value: '2026-09-12' }
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Thread due date')).toHaveValue('2026-09-12')
    )
    expect(updateThread).toHaveBeenLastCalledWith(currentThread.id, { dueDate: '2026-09-12' })

    await user.click(screen.getByRole('button', {
      name: 'Open commitment Keep sponsors aligned'
    }))
    expect(screen.getByLabelText(
      'Due date 2026-09-25 is after the parent Thread due date 2026-09-12.'
    )).toHaveAttribute('title')
    await user.click(screen.getByRole('button', { name: 'Clear Commitment due date' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Commitment due date')).toHaveValue('')
      expect(screen.getByLabelText('Commitment due date')).not.toBeDisabled()
    })
    expect(updateCommitment).toHaveBeenCalledWith(currentCommitment.id, { dueDate: null })
    fireEvent.change(screen.getByLabelText('Commitment due date'), {
      target: { value: '2026-09-11' }
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Commitment due date')).toHaveValue('2026-09-11')
    )
    expect(updateCommitment).toHaveBeenLastCalledWith(currentCommitment.id, {
      dueDate: '2026-09-11'
    })
    expect(screen.queryByLabelText(/is after the parent Thread/)).not.toBeInTheDocument()
  })

  it('refines a Thread Scope with chips, Focus suggestions, and one-click inheritance', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const customerOperations = subject(40, 'Customer Operations')
    const platformTeam = subject(41, 'Platform Team')
    const inheritedScope = {
      threadId: sprint.id,
      focusId: current.id,
      mode: 'inherited' as const,
      scopeId: 50,
      subjects: [customerOperations, platformTeam],
      focusSubjects: [customerOperations, platformTeam]
    }
    const customizedScope = {
      ...inheritedScope,
      mode: 'explicit' as const,
      scopeId: 51
    }
    const customizeThreadScope = vi.fn().mockResolvedValue(customizedScope)
    const removeThreadScopeSubject = vi.fn().mockResolvedValue({
      ...customizedScope,
      scopeId: 52,
      subjects: [platformTeam]
    })
    const addThreadScopeSubject = vi.fn().mockResolvedValue({
      ...customizedScope,
      scopeId: 53
    })
    const followFocusThreadScope = vi.fn().mockResolvedValue(inheritedScope)
    const customerUpdate = update({
      id: 31,
      parent: { type: 'thread', id: sprint.id },
      observation: 'Customer review before customization',
      scope: { scopeId: 50, subjectId: customerOperations.id }
    })
    const platformUpdate = update({
      id: 32,
      parent: { type: 'thread', id: sprint.id },
      observation: 'Platform review before customization',
      scope: { scopeId: 50, subjectId: platformTeam.id }
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getThreadScope: vi.fn().mockResolvedValue(inheritedScope),
      customizeThreadScope,
      removeThreadScopeSubject,
      addThreadScopeSubject,
      followFocusThreadScope,
      listUpdates: vi.fn(async (parent) =>
        parent.type === 'thread' ? [customerUpdate, platformUpdate] : []
      )
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    expect(await screen.findByRole('tab', { name: 'Work in Customer Operations' })).toBeVisible()
    expect(within(screen.getByRole('main')).queryByText('Scope definition')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Work in Customer Operations' }))
    expect(screen.getByRole('tab', { name: 'Work in Customer Operations' }))
      .toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    const drawer = screen.getByRole('complementary', { name: 'Thread context drawer' })
    expect(within(drawer).getByRole('radio', { name: /Inherit Focus scope/ })).toBeChecked()
    expect(within(drawer).queryByLabelText('Add a Subject to custom scope'))
      .not.toBeInTheDocument()
    await user.click(within(drawer).getByRole('radio', { name: /Custom scope/ }))
    expect(customizeThreadScope).toHaveBeenCalledWith(sprint.id)
    expect(within(drawer).getByRole('radio', { name: /Custom scope/ })).toBeChecked()
    expect(within(drawer).getByLabelText('Add a Subject to custom scope')).toBeVisible()

    await user.click(
      within(drawer).getByRole('button', { name: 'Remove Customer Operations' })
    )
    expect(removeThreadScopeSubject).toHaveBeenCalledWith(sprint.id, customerOperations.id)
    expect(screen.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    const retainedUpdates = await screen.findByRole('list', { name: 'Thread updates' })
    expect(within(retainedUpdates).getByText('Platform review before customization')).toBeVisible()
    expect(within(retainedUpdates).queryByText('Customer review before customization'))
      .not.toBeInTheDocument()
    expect(within(retainedUpdates).getByText('Platform Team', { exact: true })).toBeVisible()
    const formerUpdatesToggle = screen.getByRole('button', { name: /Former scope updates/ })
    expect(formerUpdatesToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Former scope updates' }))
      .not.toBeInTheDocument()
    await user.click(formerUpdatesToggle)
    const formerUpdates = screen.getByRole('list', { name: 'Former scope updates' })
    expect(within(formerUpdates).getByText('Customer review before customization')).toBeVisible()
    expect(within(formerUpdates).getByText('Customer Operations · Former scope')).toBeVisible()
    expect(
      within(drawer).getByRole('button', { name: 'Add Customer Operations' })
    ).toBeVisible()

    await user.click(
      within(drawer).getByRole('button', { name: 'Add Customer Operations' })
    )
    expect(addThreadScopeSubject).toHaveBeenCalledWith(sprint.id, {
      name: 'Customer Operations'
    })
    expect(within(drawer).getByRole('button', { name: 'Remove Customer Operations' }))
      .toBeVisible()
    await waitFor(() => {
      const currentUpdates = screen.getByRole('list', { name: 'Thread updates' })
      expect(within(currentUpdates).getByText('Customer review before customization')).toBeVisible()
      expect(within(currentUpdates).queryByText(/Former scope/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Former scope updates/ }))
        .not.toBeInTheDocument()
    })

    await user.click(within(drawer).getByRole('radio', { name: /Inherit Focus scope/ }))
    expect(followFocusThreadScope).toHaveBeenCalledWith(sprint.id)
    expect(within(drawer).getByRole('radio', { name: /Inherit Focus scope/ })).toBeChecked()
    expect(within(drawer).queryByLabelText('Add a Subject to custom scope'))
      .not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sprint execution' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sprint execution' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses a Thread Subject lens for exact-cell Updates and Commitment projections', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const customer = subject(40, 'Customer Operations')
    const platform = subject(41, 'Platform Team')
    const scope = {
      threadId: sprint.id,
      focusId: current.id,
      mode: 'inherited' as const,
      scopeId: 50,
      subjects: [customer, platform],
      focusSubjects: [customer, platform]
    }
    const inheritedCommitment = commitment({
      id: 21,
      parent: { type: 'thread', id: sprint.id },
      title: 'Improve ticket quality',
      state: 'yellow'
    })
    const platformCommitment = commitment({
      id: 22,
      parent: { type: 'thread', id: sprint.id },
      title: 'Stabilize build agents',
      state: 'green'
    })
    const openCommitment = commitment({
      id: 23,
      parent: { type: 'thread', id: sprint.id },
      title: 'Unscoped coordination'
    })
    const customerUpdate = update({
      id: 31,
      parent: { type: 'thread', id: sprint.id },
      observation: 'Customer tickets are still unclear',
      state: 'red',
      scope: { scopeId: 50, subjectId: customer.id }
    })
    const platformUpdate = update({
      id: 32,
      parent: { type: 'thread', id: sprint.id },
      observation: 'Platform ticket quality improved',
      state: 'green',
      scope: { scopeId: 50, subjectId: platform.id }
    })
    const subjectMatrix = [
      {
        scopeId: 50,
        subjectId: customer.id,
        subject: customer,
        state: 'red' as const,
        lastReviewDate: '2026-08-07',
        nextReviewDate: '2026-08-14',
        reviewDue: false,
        commitments: [{
          commitmentId: inheritedCommitment.id,
          scopeId: 50,
          subjectId: customer.id,
          state: 'red' as const,
          lastUpdateDate: '2026-08-06',
          nextUpdateDate: null,
          needsUpdate: false
        }]
      },
      {
        scopeId: 50,
        subjectId: platform.id,
        subject: platform,
        state: 'green' as const,
        lastReviewDate: '2026-08-08',
        nextReviewDate: '2026-08-15',
        reviewDue: false,
        commitments: [{
          commitmentId: platformCommitment.id,
          scopeId: 52,
          subjectId: platform.id,
          state: 'green' as const,
          lastUpdateDate: '2026-08-08',
          nextUpdateDate: null,
          needsUpdate: false
        }]
      }
    ]
    const createUpdate = vi.fn(async (input) => update({
      id: 33,
      parent: input.parent,
      date: input.date,
      observation: input.observation,
      state: input.state,
      scope: input.scope ?? null
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getThreadScope: vi.fn().mockResolvedValue(scope),
      getThreadSubjectMatrix: vi.fn().mockResolvedValue(subjectMatrix),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'thread'
          ? [inheritedCommitment, platformCommitment, openCommitment]
          : []
      ),
      listUpdates: vi.fn(async (parent) =>
        parent.type === 'thread' ? [customerUpdate, platformUpdate] : []
      ),
      createUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    const allUpdates = await screen.findByRole('list', { name: 'Thread updates' })
    expect(within(allUpdates).getByText('Customer tickets are still unclear')).toBeVisible()
    expect(within(allUpdates).getByText('Platform ticket quality improved')).toBeVisible()
    expect(within(allUpdates).getByText('Customer Operations')).toBeVisible()
    expect(within(allUpdates).getByText('Platform Team')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add update' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Work in Customer Operations' }))
    const customerUpdates = await screen.findByRole('list', { name: 'Thread updates' })
    expect(within(customerUpdates).getByText('Customer tickets are still unclear')).toBeVisible()
    expect(within(customerUpdates).queryByText('Platform ticket quality improved'))
      .not.toBeInTheDocument()
    const currentCommitments = screen.getByRole('list', { name: 'Current commitments' })
    expect(within(currentCommitments).getByRole('button', {
      name: 'Open commitment Improve ticket quality'
    })).toBeVisible()
    expect(within(currentCommitments).queryByRole('button', {
      name: 'Open commitment Stabilize build agents'
    })).not.toBeInTheDocument()
    expect(within(currentCommitments).queryByRole('button', {
      name: 'Open commitment Unscoped coordination'
    })).not.toBeInTheDocument()
    expect(within(currentCommitments).getByText('Red', { selector: '[data-tone="danger"]' }))
      .toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add commitment' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    expect(createUpdate).toHaveBeenCalledWith({
      parent: { type: 'thread', id: sprint.id },
      date: expect.any(String),
      observation: '',
      state: 'none',
      sensitive: false,
      scope: { scopeId: 50, subjectId: customer.id }
    })
  })

  it('carries one Subject selection across contexts and remembers it independently per Focus', async () => {
    const atlas = focus({ id: 1, title: 'Project Atlas' })
    const horizon = focus({ id: 2, title: 'Project Horizon' })
    const atlasDelivery = thread({ id: 10, focusId: atlas.id, title: 'Atlas delivery' })
    const atlasPlatform = thread({ id: 11, focusId: atlas.id, title: 'Atlas platform' })
    const horizonDelivery = thread({ id: 20, focusId: horizon.id, title: 'Horizon delivery' })
    const customer = subject(40, 'Customer Operations')
    const platform = subject(41, 'Platform Team')
    const scopedCommitment = commitment({
      id: 21,
      parent: { type: 'thread', id: atlasDelivery.id },
      title: 'Preserve the selected lens'
    })
    const scopes = new Map([
      [atlasDelivery.id, { scopeId: 50, subject: customer, focusId: atlas.id }],
      [atlasPlatform.id, { scopeId: 51, subject: platform, focusId: atlas.id }],
      [horizonDelivery.id, { scopeId: 52, subject: platform, focusId: horizon.id }]
    ])
    installApi({
      listFocuses: vi.fn().mockResolvedValue([atlas, horizon]),
      listThreads: vi.fn(async (focusId) =>
        focusId === atlas.id
          ? [atlasDelivery, atlasPlatform]
          : [horizonDelivery]
      ),
      getThreadScope: vi.fn(async (threadId) => {
        const entry = scopes.get(threadId)
        if (!entry) throw new Error('Unknown Thread')
        return {
          threadId,
          focusId: entry.focusId,
          mode: 'inherited' as const,
          scopeId: entry.scopeId,
          subjects: [entry.subject],
          focusSubjects: [entry.subject]
        }
      }),
      getThreadSubjectMatrix: vi.fn(async (threadId) => {
        const entry = scopes.get(threadId)
        if (!entry) throw new Error('Unknown Thread')
        return [{
          scopeId: entry.scopeId,
          subjectId: entry.subject.id,
          subject: entry.subject,
          state: 'none' as const,
          lastReviewDate: null,
          nextReviewDate: '2026-08-15',
          reviewDue: false,
          commitments: threadId === atlasDelivery.id
            ? [{
                commitmentId: scopedCommitment.id,
                scopeId: entry.scopeId,
                subjectId: entry.subject.id,
                state: 'none' as const,
                lastUpdateDate: null,
                nextUpdateDate: null,
                needsUpdate: false
              }]
            : []
        }]
      }),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'thread' && parent.id === atlasDelivery.id
          ? [scopedCommitment]
          : []
      ),
      getCommitmentWorkingContext: vi.fn(async (commitmentId) => ({
        commitmentId,
        scopeId: 50,
        cells: [{
          scopeId: 50,
          subjectId: customer.id,
          subject: customer,
          state: 'none' as const,
          lastReviewDate: null,
          lastUpdateDate: null,
          nextUpdateDate: null,
          needsUpdate: false
        }]
      }))
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Atlas delivery' }))
    await user.click(await screen.findByRole('tab', { name: 'Work in Customer Operations' }))
    await user.click(screen.getByRole('button', {
      name: 'Open commitment Preserve the selected lens'
    }))
    expect(await screen.findByRole('tab', { name: 'Work in Customer Operations' }))
      .toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('button', { name: 'Atlas platform' }))
    expect(await screen.findByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: 'Atlas delivery' }))
    expect(screen.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Work in Customer Operations' }))

    await user.click(screen.getByRole('button', { name: 'Project Horizon' }))
    await user.click(await screen.findByRole('button', { name: 'Horizon delivery' }))
    await user.click(await screen.findByRole('tab', { name: 'Work in Platform Team' }))

    await user.click(screen.getByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Atlas delivery' }))
    expect(await screen.findByRole('tab', { name: 'Work in Customer Operations' }))
      .toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('button', { name: 'Project Horizon' }))
    await user.click(await screen.findByRole('button', { name: 'Horizon delivery' }))
    expect(await screen.findByRole('tab', { name: 'Work in Platform Team' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('creates and edits a Subject Update from the All Subjects dropdown', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const customer = subject(40, 'Customer Operations')
    const platform = subject(41, 'Platform Team')
    const scope = {
      threadId: sprint.id,
      focusId: current.id,
      mode: 'inherited' as const,
      scopeId: 50,
      subjects: [customer, platform],
      focusSubjects: [customer, platform]
    }
    const createUpdate = vi.fn(async (input) => update({
      id: 33,
      parent: input.parent,
      date: input.date,
      observation: input.observation,
      state: input.state,
      scope: input.scope ?? null
    }))
    const updateUpdate = vi.fn(async (id, input) => update({
      id,
      parent: { type: 'thread', id: sprint.id },
      date: input.date ?? '2026-08-08',
      observation: input.observation ?? '',
      state: input.state ?? 'none',
      sensitive: input.sensitive ?? false,
      scope: { scopeId: 50, subjectId: customer.id }
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getThreadScope: vi.fn().mockResolvedValue(scope),
      getThreadSubjectMatrix: vi.fn().mockResolvedValue([]),
      createUpdate,
      updateUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    expect(screen.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Add update' })).not.toBeInTheDocument()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Add update for Subject…' }),
      String(customer.id)
    )
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    expect(createUpdate).toHaveBeenCalledWith({
      parent: { type: 'thread', id: sprint.id },
      date: expect.any(String),
      observation: '',
      state: 'none',
      sensitive: false,
      scope: { scopeId: 50, subjectId: customer.id }
    })

    const updates = await screen.findByRole('list', { name: 'Thread updates' })
    expect(within(updates).getByText('Customer Operations')).toBeVisible()
    await user.selectOptions(within(updates).getByLabelText('Update state'), 'yellow')
    await waitFor(() => expect(updateUpdate).toHaveBeenCalled(), { timeout: 2_000 })
    expect(updateUpdate.mock.calls.at(-1)?.[1]).toMatchObject({ state: 'yellow' })
    expect(screen.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('creates Todos in Thread aggregate and exact Subject contexts', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const customer = subject(40, 'Customer Operations')
    const platform = subject(41, 'Platform Team')
    const cells = [customer, platform].map((cellSubject) => ({
      scopeId: 50,
      subjectId: cellSubject.id,
      subject: cellSubject,
      state: 'none' as const,
      lastReviewDate: null,
      nextReviewDate: '2026-08-16',
      reviewDue: false,
      commitments: []
    }))
    let nextTodoId = 70
    const listTodos = vi.fn().mockResolvedValue([])
    const createTodo = vi.fn(async (input) => todo({
      id: ++nextTodoId,
      name: input.name,
      parent: input.parent,
      subject: input.parent.type === 'thread-scope'
        ? [customer, platform].find(({ id }) => id === input.parent.scope.subjectId) ?? null
        : null,
      dueDate: input.dueDate ?? null,
      sharedAcrossSubjects: input.sharedAcrossSubjects ?? false,
      subjectCompletions: input.sharedAcrossSubjects
        ? [customer, platform].map((completionSubject) => ({
            subject: completionSubject,
            done: false,
            completedAt: null,
            createdAt: '2026-08-10T12:00:00.000Z',
            updatedAt: '2026-08-10T12:00:00.000Z'
          }))
        : []
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getThreadScope: vi.fn().mockResolvedValue({
        threadId: sprint.id,
        focusId: current.id,
        mode: 'explicit',
        scopeId: 50,
        subjects: [customer, platform],
        focusSubjects: []
      }),
      getThreadSubjectMatrix: vi.fn().mockResolvedValue(cells),
      listTodos,
      createTodo
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    await waitFor(() => expect(listTodos).toHaveBeenCalledWith({
      type: 'thread',
      id: sprint.id
    }))

    await user.click(screen.getByRole('tab', { name: 'Work in Customer Operations' }))
    await waitFor(() => expect(listTodos).toHaveBeenCalledWith({
      type: 'thread-scope',
      id: sprint.id,
      scope: { scopeId: 50, subjectId: customer.id }
    }))
    await user.type(screen.getByLabelText('New Todo name'), 'Call customer owner')
    fireEvent.change(screen.getByLabelText('New Todo due date'), {
      target: { value: '2026-08-20' }
    })
    await user.click(screen.getByRole('button', { name: 'Add Todo' }))
    await waitFor(() => expect(createTodo).toHaveBeenLastCalledWith({
      parent: {
        type: 'thread-scope',
        id: sprint.id,
        scope: { scopeId: 50, subjectId: customer.id }
      },
      name: 'Call customer owner',
      dueDate: '2026-08-20'
    }))

    await user.click(screen.getByRole('tab', { name: 'All subjects' }))
    await user.type(screen.getByLabelText('New Todo name'), 'Confirm platform owner')
    const todoContext = screen.getByLabelText('New Todo context')
    expect(within(todoContext).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['All subjects', 'Customer Operations', 'Platform Team'])
    await user.click(screen.getByRole('button', { name: 'Add Todo' }))
    await waitFor(() => expect(createTodo).toHaveBeenLastCalledWith({
      parent: { type: 'thread', id: sprint.id },
      name: 'Confirm platform owner',
      dueDate: null,
      sharedAcrossSubjects: true
    }))
    expect(screen.getByLabelText(
      'Confirm platform owner completes when every Subject is done'
    )).toBeDisabled()

    await user.type(screen.getByLabelText('New Todo name'), 'Confirm individual owner')
    await user.selectOptions(todoContext, 'scope:50:subject:41')
    await user.click(screen.getByRole('button', { name: 'Add Todo' }))
    await waitFor(() => expect(createTodo).toHaveBeenLastCalledWith({
      parent: {
        type: 'thread-scope',
        id: sprint.id,
        scope: { scopeId: 50, subjectId: platform.id }
      },
      name: 'Confirm individual owner',
      dueDate: null
    }))
  })

  it('shows only current Thread Subject Todos outside the aggregate orphaned accordion', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const customer = subject(40, 'Customer Operations')
    const platform = subject(41, 'Platform Team')
    const currentCustomerTodo = todo({
      id: 71,
      name: 'Review customer rollout',
      parent: {
        type: 'thread-scope',
        id: sprint.id,
        scope: { scopeId: 45, subjectId: customer.id }
      },
      subject: customer
    })
    const removedPlatformTodo = todo({
      id: 72,
      name: 'Review former platform rollout',
      parent: {
        type: 'thread-scope',
        id: sprint.id,
        scope: { scopeId: 45, subjectId: platform.id }
      },
      subject: platform
    })
    const oldFallbackTodo = todo({
      id: 73,
      name: 'Review old thread-wide rollout',
      parent: { type: 'thread', id: sprint.id }
    })
    const listTodos = vi.fn(async (context: TodoParent) => {
      if (context.type === 'thread') {
        return [currentCustomerTodo, removedPlatformTodo, oldFallbackTodo]
      }
      if (
        context.type === 'thread-scope' &&
        context.scope.subjectId === customer.id
      ) {
        return [currentCustomerTodo]
      }
      return []
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getThreadScope: vi.fn().mockResolvedValue({
        threadId: sprint.id,
        focusId: current.id,
        mode: 'explicit',
        scopeId: 50,
        subjects: [customer],
        focusSubjects: [customer, platform]
      }),
      getThreadSubjectMatrix: vi.fn().mockResolvedValue([{
        scopeId: 50,
        subjectId: customer.id,
        subject: customer,
        state: 'none',
        lastReviewDate: null,
        nextReviewDate: '2026-08-16',
        reviewDue: false,
        commitments: []
      }]),
      listTodos
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    const currentTodos = await screen.findByRole('list', {
      name: 'thread Todos sortable list'
    })
    expect(within(currentTodos).getByDisplayValue('Review customer rollout')).toBeVisible()
    expect(within(currentTodos).queryByDisplayValue('Review former platform rollout'))
      .not.toBeInTheDocument()

    const orphanedToggle = screen.getByRole('button', { name: /Orphaned Todos/ })
    expect(orphanedToggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(orphanedToggle)
    const orphanedTodos = screen.getByRole('list', { name: 'Orphaned Todos' })
    expect(within(orphanedTodos).getByDisplayValue('Review former platform rollout'))
      .toBeVisible()
    expect(within(orphanedTodos).getByDisplayValue('Review old thread-wide rollout'))
      .toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'Work in Customer Operations' }))
    await waitFor(() => expect(listTodos).toHaveBeenCalledWith({
      type: 'thread-scope',
      id: sprint.id,
      scope: { scopeId: 50, subjectId: customer.id }
    }))
    expect(screen.queryByRole('button', { name: /Orphaned Todos/ })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Review customer rollout')).toBeVisible()
  })

  it('creates an unscoped Thread-wide Update when no Subjects are effective', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const createUpdate = vi.fn(async (input) => update({
      id: 33,
      parent: input.parent,
      date: input.date,
      observation: input.observation,
      state: input.state,
      scope: input.scope ?? null
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getThreadScope: vi.fn().mockResolvedValue({
        threadId: sprint.id,
        focusId: current.id,
        mode: 'explicit',
        scopeId: 50,
        subjects: [],
        focusSubjects: []
      }),
      createUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    expect(screen.queryByRole('tablist', { name: 'Thread working context' }))
      .not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    expect(createUpdate).toHaveBeenCalledWith({
      parent: { type: 'thread', id: sprint.id },
      date: expect.any(String),
      observation: '',
      state: 'none',
      sensitive: false
    })
  })

  it('creates Commitment Updates in an exact Subject cell instead of sending an invalid unscoped write', async () => {
    const current = focus({ title: 'Project Atlas' })
    const customer = subject(40, 'Customer Operations')
    const platform = subject(41, 'Platform Team')
    const boundedCommitment = commitment({
      id: 21,
      title: 'Improve ticket quality'
    })
    const workingContext = {
      commitmentId: boundedCommitment.id,
      scopeId: 50,
      cells: [customer, platform].map((cellSubject) => ({
        scopeId: 50,
        subjectId: cellSubject.id,
        subject: cellSubject,
        state: 'none' as const,
        lastUpdateDate: null,
        nextUpdateDate: null,
        needsUpdate: false
      }))
    }
    let updateId = 30
    const createUpdate = vi.fn(async (input) => update({
      id: ++updateId,
      parent: input.parent,
      date: input.date,
      observation: input.observation,
      state: input.state,
      sensitive: input.sensitive,
      scope: input.scope ?? null
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [boundedCommitment] : []
      ),
      getCommitmentWorkingContext: vi.fn().mockResolvedValue(workingContext),
      createUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', {
      name: 'Open commitment Improve ticket quality'
    }))

    expect(await screen.findByRole('tablist', {
      name: 'Commitment working context'
    })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Add update' })).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Add update for Subject…' }),
      String(customer.id)
    )
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    expect(createUpdate).toHaveBeenLastCalledWith({
      parent: { type: 'commitment', id: boundedCommitment.id },
      date: expect.any(String),
      observation: '',
      state: 'none',
      sensitive: false,
      scope: { scopeId: 50, subjectId: customer.id }
    })

    await user.click(screen.getByRole('tab', { name: 'Work in Platform Team' }))
    expect(screen.getByRole('tab', { name: 'Work in Platform Team' }))
      .toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledTimes(2))
    expect(createUpdate).toHaveBeenLastCalledWith({
      parent: { type: 'commitment', id: boundedCommitment.id },
      date: expect.any(String),
      observation: '',
      state: 'none',
      sensitive: false,
      scope: { scopeId: 50, subjectId: platform.id }
    })
  })

  it('reuses parent-aware Commitment and Update flows inside a Thread', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread()
    const focusCommitment = commitment({ id: 20, title: 'Focus boundary' })
    const threadCommitment = commitment({
      id: 21,
      parent: { type: 'thread', id: sprint.id },
      title: 'Improve ticket quality',
      state: 'yellow',
      lastUpdateDate: '2026-08-04'
    })
    const createdCommitment = commitment({
      id: 22,
      parent: { type: 'thread', id: sprint.id },
      title: 'Keep refinement healthy'
    })
    const threadUpdate = update({
      id: 31,
      parent: { type: 'thread', id: sprint.id },
      observation: 'The sprint boundary is getting clearer',
      state: 'green'
    })
    const createCommitment = vi.fn().mockResolvedValue(createdCommitment)
    const createUpdate = vi.fn(async (input) => update({
      id: 32,
      parent: input.parent,
      date: input.date ?? '2026-08-07',
      observation: input.observation,
      state: input.state
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [focusCommitment] : [threadCommitment]
      ),
      listUpdates: vi.fn(async (parent) =>
        parent.type === 'thread' ? [threadUpdate] : []
      ),
      createCommitment,
      createUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))

    const currentCommitments = await screen.findByRole('list', {
      name: 'Current commitments'
    })
    expect(
      within(currentCommitments).getByRole('button', {
        name: 'Open commitment Improve ticket quality'
      })
    ).toBeVisible()
    expect(
      within(currentCommitments).queryByRole('button', {
        name: 'Open commitment Focus boundary'
      })
    ).not.toBeInTheDocument()
    const threadUpdates = await screen.findByRole('list', { name: 'Thread updates' })
    expect(
      within(threadUpdates).getByText('The sprint boundary is getting clearer')
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Commitments' }))
    const navigation = screen.getByRole('navigation', { name: 'Thread commitments' })
    expect(
      within(navigation).getByRole('button', { name: 'Improve ticket quality' })
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Improve ticket quality' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    const drawer = screen.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    expect(within(drawer).getByText('Thread — Sprint execution')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'New commitment' }))
    const dialog = screen.getByRole('dialog', { name: 'New commitment' })
    expect(within(dialog).getByText('Add a Thread-level commitment.')).toBeVisible()
    expect(within(dialog).queryByLabelText('Type')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Title/), 'Keep refinement healthy')
    await user.click(within(dialog).getByRole('button', { name: 'Create commitment' }))
    expect(createCommitment).toHaveBeenCalledWith({
      parent: { type: 'thread', id: sprint.id },
      type: 'ongoing',
      title: 'Keep refinement healthy',
      dueDate: null
    })
    expect(
      await within(navigation).findByRole('button', { name: 'Keep refinement healthy' })
    ).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'Back to Focus sections' }))
    expect(screen.getByRole('heading', { name: 'Sprint execution' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    expect(createUpdate).toHaveBeenCalledWith({
      parent: { type: 'thread', id: sprint.id },
      date: expect.any(String),
      observation: '',
      state: 'none',
      sensitive: false
    })
  })

  it('adds and removes Focus Scope Subjects inline from Overall', async () => {
    const current = focus()
    const sprint = thread()
    const customerOperations = {
      id: 40,
      kind: 'generic',
      name: 'Customer Operations',
      description: null,
      externalKey: null,
      sensitive: false,
      createdAt: '2026-08-08T12:00:00.000Z',
      updatedAt: '2026-08-08T12:00:00.000Z'
    }
    let subjectApplied = false
    const addFocusScopeSubject = vi.fn(async () => {
      subjectApplied = true
      return {
        focusId: current.id,
        mode: 'explicit' as const,
        scopeId: 50,
        subjects: [customerOperations]
      }
    })
    const removeFocusScopeSubject = vi.fn(async () => {
      subjectApplied = false
      return {
        focusId: current.id,
        mode: 'explicit' as const,
        scopeId: 50,
        subjects: []
      }
    })
    const getThreadScope = vi.fn(async () => ({
      threadId: sprint.id,
      focusId: current.id,
      mode: 'inherited' as const,
      scopeId: subjectApplied ? 50 : null,
      subjects: subjectApplied ? [customerOperations] : [],
      focusSubjects: subjectApplied ? [customerOperations] : []
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getFocusScope: vi.fn().mockResolvedValue({
        focusId: current.id,
        mode: 'open',
        scopeId: null,
        subjects: []
      }),
      addFocusScopeSubject,
      removeFocusScopeSubject,
      getThreadScope
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    expect(await screen.findByText('Open scope — add a Subject to define its boundary.'))
      .toBeVisible()
    const subjectInput = screen.getByRole('textbox', { name: 'Add a Subject' })
    await user.type(subjectInput, 'Customer Operations{Enter}')

    expect(addFocusScopeSubject).toHaveBeenCalledWith(1, { name: 'Customer Operations' })
    const subjects = await screen.findByRole('list', { name: 'Subjects in scope' })
    expect(within(subjects).getByText('Customer Operations')).toBeVisible()
    expect(screen.getByText('1 Subject in scope')).toBeVisible()
    expect(subjectInput).toHaveValue('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Sprint execution$/ }))
    expect(await screen.findByRole('tab', { name: 'Work in Customer Operations' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Add update for Subject…' }))
      .toHaveDisplayValue('Add update for Subject…')
    await user.click(screen.getByRole('button', { name: /^Overall$/ }))

    await user.click(
      within(screen.getByRole('list', { name: 'Subjects in scope' }))
        .getByRole('button', { name: 'Remove Customer Operations from scope' })
    )
    await waitFor(() => expect(removeFocusScopeSubject).toHaveBeenCalledWith(1, 40))
    expect(screen.queryByRole('list', { name: 'Subjects in scope' })).not.toBeInTheDocument()
    expect(screen.getByText('0 Subjects in scope')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await user.click(screen.getByRole('button', { name: /^Sprint execution$/ }))
    expect(screen.queryByRole('tablist', { name: 'Thread working context' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Work in Customer Operations' }))
      .not.toBeInTheDocument()
    expect(getThreadScope.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('does not let a stale initial Thread projection overwrite a Focus Scope mutation', async () => {
    const current = focus()
    const sprint = thread()
    const customerOperations = subject(40, 'Customer Operations')
    let resolveInitialScope: ((scope: {
      threadId: number
      focusId: number
      mode: 'inherited'
      scopeId: null
      subjects: SubjectSnapshot[]
      focusSubjects: SubjectSnapshot[]
    }) => void) | undefined
    const initialScope = new Promise<{
      threadId: number
      focusId: number
      mode: 'inherited'
      scopeId: null
      subjects: SubjectSnapshot[]
      focusSubjects: SubjectSnapshot[]
    }>((resolve) => {
      resolveInitialScope = resolve
    })
    const currentThreadScope = {
      threadId: sprint.id,
      focusId: current.id,
      mode: 'inherited' as const,
      scopeId: 50,
      subjects: [customerOperations],
      focusSubjects: [customerOperations]
    }
    const getThreadScope = vi.fn()
      .mockImplementationOnce(() => initialScope)
      .mockResolvedValue(currentThreadScope)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      getFocusScope: vi.fn().mockResolvedValue({
        focusId: current.id,
        mode: 'open',
        scopeId: null,
        subjects: []
      }),
      addFocusScopeSubject: vi.fn().mockResolvedValue({
        focusId: current.id,
        mode: 'explicit',
        scopeId: 50,
        subjects: [customerOperations]
      }),
      getThreadScope
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await waitFor(() => expect(getThreadScope).toHaveBeenCalledOnce())
    await user.type(await screen.findByRole('textbox', { name: 'Add a Subject' }),
      'Customer Operations{Enter}')
    await screen.findByRole('button', { name: /^Sprint execution$/ })

    await act(async () => {
      resolveInitialScope?.({
        threadId: sprint.id,
        focusId: current.id,
        mode: 'inherited',
        scopeId: null,
        subjects: [],
        focusSubjects: []
      })
      await Promise.resolve()
    })

    await user.click(screen.getByRole('button', { name: /^Sprint execution$/ }))
    expect(await screen.findByRole('tab', { name: 'Work in Customer Operations' })).toBeVisible()
    expect(getThreadScope).toHaveBeenCalledTimes(2)
  })

  it('persists the Focus goal and drills into focus-level commitments', async () => {
    const current = focus({ goal: 'Deliver the release safely' })
    const updated = focus({ goal: 'Deliver predictable customer value' })
    const focusCommitment = commitment({ state: 'red', lastUpdateDate: '2026-01-04' })
    const updateFocus = vi.fn().mockResolvedValue(updated)
    const listCommitments = vi.fn().mockResolvedValue([focusCommitment])
    const api = installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      updateFocus,
      listCommitments
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    const goal = await screen.findByLabelText('Goal')
    expect(goal).toHaveTextContent('Deliver the release safely')
    await user.type(goal, ' and predictably')
    const saveDocument = vi.mocked(api.richText.saveDocument)
    await waitFor(() => expect(saveDocument).toHaveBeenCalled(), { timeout: 2_000 })
    const goalInput = saveDocument.mock.calls.at(-1)?.[1] as string
    expect(saveDocument.mock.calls.at(-1)?.[0]).toEqual({
      type: 'focus', id: 1, field: 'goal'
    })
    expect(isRichText(goalInput)).toBe(true)
    expect(richTextPlainText(goalInput)).toBe(' and predictablyDeliver the release safely')
    expect(listCommitments).toHaveBeenCalledWith({ type: 'focus', id: 1 })
    const commitmentRow = screen
      .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
      .closest<HTMLElement>('[role="listitem"]')
    expect(commitmentRow).not.toBeNull()
    expect(
      within(commitmentRow!).getByText('Active', {
        selector: '[data-slot="lifecycle-status-label"]'
      })
    ).toBeVisible()
    expect(within(commitmentRow!).getByText('Red', { selector: '[data-tone="danger"]' })).toBeVisible()
    expect(within(commitmentRow!).getByText('Last updated · 2026-01-04')).toBeVisible()

    await user.click(
      await screen.findByRole('button', { name: 'Open commitment Keep sponsors aligned' })
    )
    const focusSections = screen.getByRole('navigation', { name: 'Focus sections' })
    expect(focusSections).toBeInTheDocument()
    expect(
      within(focusSections).getByRole('button', {
        name: 'Open Overall commitment Keep sponsors aligned'
      })
    ).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('heading', { name: 'Keep sponsors aligned' })).toBeInTheDocument()
    expect(screen.getByLabelText('Commitment last updated')).toHaveTextContent(
      'Last updated · 2026-01-04'
    )
    expect(screen.getByRole('button', { name: 'New thread' })).toBeInTheDocument()

    await user.click(within(focusSections).getByRole('button', { name: 'Overall' }))
    await user.click(
      screen.getByRole('button', { name: 'Commitments' })
    )
    const commitmentNavigation = screen.getByRole('navigation', {
      name: 'Focus commitments'
    })
    expect(
      within(commitmentNavigation).getByRole('button', { name: 'Keep sponsors aligned' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(commitmentNavigation).getByText('Active · Last updated · 2026-01-04')
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'New thread' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New commitment' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to Focus sections' }))
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('button', { name: 'New thread' })).toBeInTheDocument()
  })

  it('shows Commitment status in lists and changes it from the detail header', async () => {
    const current = focus()
    const activeCommitment = commitment({ status: 'active' })
    const pausedCommitment = commitment({ status: 'paused' })
    const updateCommitment = vi.fn().mockResolvedValue(pausedCommitment)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listCommitments: vi.fn().mockResolvedValue([activeCommitment]),
      updateCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    const commitmentRow = screen
      .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
      .closest<HTMLElement>('[role="listitem"]')
    expect(commitmentRow).not.toBeNull()
    expect(
      within(commitmentRow!).getByText('Active', {
        selector: '[data-slot="lifecycle-status-label"]'
      })
    ).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'Commitments' })
    )
    const commitmentNavigation = screen.getByRole('navigation', {
      name: 'Focus commitments'
    })
    expect(within(commitmentNavigation).getByText('Active · Last updated · Never')).toBeVisible()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Commitment status' }), 'paused')

    expect(updateCommitment).toHaveBeenCalledWith(20, { status: 'paused' })
    expect(
      await within(commitmentNavigation).findByText('Paused · Last updated · Never')
    ).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Commitment status' })).toHaveValue('paused')
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    const commitmentDrawer = screen.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    expect(within(commitmentDrawer).getByText('paused')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Back to Focus sections' }))
    const updatedRow = screen
      .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
      .closest<HTMLElement>('[role="listitem"]')
    expect(updatedRow).not.toBeNull()
    expect(
      within(updatedRow!).getByText('Paused', {
        selector: '[data-slot="lifecycle-status-label"]'
      })
    ).toBeVisible()
  })

  it('closes due-dated commitments from list rows through the audited status mutation', async () => {
    const current = focus()
    const undatedLegacyAction = commitment({
      id: 20,
      type: 'action',
      title: 'Maintain team health'
    })
    const dueDatedLegacyOngoing = commitment({
      id: 21,
      type: 'ongoing',
      title: 'Publish launch plan',
      dueDate: '2026-09-15'
    })
    const doneAction = commitment({
      ...dueDatedLegacyOngoing,
      status: 'done'
    })
    const updateCommitment = vi.fn().mockResolvedValue(doneAction)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listCommitments: vi.fn().mockResolvedValue([
        undatedLegacyAction,
        dueDatedLegacyOngoing
      ]),
      updateCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    const undatedRow = screen
      .getByRole('button', { name: 'Open commitment Maintain team health' })
      .closest<HTMLElement>('[role="listitem"]')
    const dueDatedRow = screen
      .getByRole('button', { name: 'Open commitment Publish launch plan' })
      .closest<HTMLElement>('[role="listitem"]')
    expect(undatedRow).not.toBeNull()
    expect(dueDatedRow).not.toBeNull()
    expect(within(undatedRow!).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(dueDatedRow!).queryByText('Action')).not.toBeInTheDocument()
    expect(within(dueDatedRow!).getByText('Due · 2026-09-15')).toBeVisible()

    await user.click(
      within(dueDatedRow!).getByRole('checkbox', {
        name: 'Mark commitment Publish launch plan done'
      })
    )

    expect(updateCommitment).toHaveBeenCalledWith(21, { status: 'done' })
    const closedAccordion = await screen.findByRole('button', { name: /Done \/ Cancelled/ })
    expect(closedAccordion).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('list', { name: 'Done and cancelled commitments' })
    ).not.toBeInTheDocument()
    await user.click(closedAccordion)
    const closedList = screen.getByRole('list', { name: 'Done and cancelled commitments' })
    const completedCheckbox = await within(closedList).findByRole('checkbox', {
      name: 'Mark commitment Publish launch plan done'
    })
    expect(completedCheckbox).toBeChecked()
    expect(completedCheckbox).toBeDisabled()

    await user.click(
      within(closedList).getByRole('button', { name: 'Open commitment Publish launch plan' })
    )
    expect(
      screen.queryByRole('checkbox', { name: /Mark commitment/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Commitment type')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Commitment due date')).toHaveValue('2026-09-15')
  })

  it('groups and orders Commitment lists through the shared collection model', async () => {
    const current = focus()
    const commitments = [
      commitment({ id: 1, title: 'Done item', status: 'done', state: 'red' }),
      commitment({ id: 2, title: 'No-state item', status: 'active', state: 'none' }),
      commitment({ id: 3, title: 'Paused item', status: 'paused', state: 'red' }),
      commitment({ id: 4, title: 'Green item', status: 'active', state: 'green' }),
      commitment({ id: 5, title: 'Cancelled item', status: 'cancelled', state: 'yellow' }),
      commitment({ id: 6, title: 'Red item', status: 'active', state: 'red' }),
      commitment({ id: 7, title: 'Yellow item', status: 'active', state: 'yellow' })
    ]
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listCommitments: vi.fn().mockResolvedValue(commitments)
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    const currentList = screen.getByRole('list', { name: 'Current commitments' })
    const closedAccordion = screen.getByRole('button', { name: /Done \/ Cancelled/ })
    expect(closedAccordion).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('list', { name: 'Done and cancelled commitments' })
    ).not.toBeInTheDocument()
    expect(
      within(currentList)
        .getAllByRole('button', { name: /^Open commitment/ })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Open commitment Red item',
      'Open commitment Yellow item',
      'Open commitment Green item',
      'Open commitment No-state item',
      'Open commitment Paused item'
    ])
    expect(within(currentList).getByText('Active', { selector: '[role="presentation"]' })).toBeVisible()
    expect(within(currentList).getByText('Paused', { selector: '[role="presentation"]' })).toBeVisible()
    await user.click(closedAccordion)
    const closedList = screen.getByRole('list', { name: 'Done and cancelled commitments' })
    expect(
      within(closedList)
        .getAllByRole('button', { name: /^Open commitment/ })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Open commitment Done item', 'Open commitment Cancelled item'])

    await user.click(screen.getByRole('button', { name: 'Commitments' }))
    const navigation = screen.getByRole('navigation', { name: 'Focus commitments' })
    const commitmentTitles = new Set(commitments.map(({ title }) => title))
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
        .filter((label): label is string => label !== null && commitmentTitles.has(label))
    ).toEqual([
      'Red item',
      'Yellow item',
      'Green item',
      'No-state item',
      'Paused item'
    ])
    expect(within(navigation).queryByRole('button', { name: 'Done item' })).not.toBeInTheDocument()
    expect(
      within(navigation).queryByRole('button', { name: 'Cancelled item' })
    ).not.toBeInTheDocument()
    expect(
      within(navigation).getByText('Active', { selector: '[data-slot="sidebar-group-label"]' })
    ).toBeVisible()
    expect(
      within(navigation).getByText('Paused', { selector: '[data-slot="sidebar-group-label"]' })
    ).toBeVisible()
    expect(
      within(navigation).queryByText('Done / Cancelled', {
        selector: '[data-slot="sidebar-group-label"]'
      })
    ).not.toBeInTheDocument()
  })

  it('lists direct Focus Updates in Overall and refreshes the derived review date', async () => {
    let lastReviewDate = '2026-08-01'
    const directUpdate = update({
      id: 40,
      parent: { type: 'focus', id: 1 },
      date: lastReviewDate,
      observation: 'The overall launch remains clear',
      state: 'green'
    })
    const listFocuses = vi.fn(async () => [focus({ lastReviewDate })])
    const listUpdates = vi.fn(async (parent) =>
      parent.type === 'focus' ? [directUpdate] : []
    )
    const createUpdate = vi.fn(async (input) => {
      lastReviewDate = input.date ?? lastReviewDate
      return update({
        id: 41,
        parent: input.parent,
        date: lastReviewDate,
        observation: input.observation,
        state: input.state
      })
    })
    installApi({ listFocuses, listUpdates, createUpdate })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    const focusUpdates = await screen.findByRole('list', { name: 'Focus updates' })
    expect(within(focusUpdates).getByText('The overall launch remains clear')).toBeVisible()
    expect(listUpdates).toHaveBeenCalledWith({ type: 'focus', id: 1 })
    expect(screen.queryByRole('list', { name: 'Commitment updates' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    const newDate = createUpdate.mock.calls[0][0].date
    expect(createUpdate).toHaveBeenCalledWith({
      parent: { type: 'focus', id: 1 },
      date: newDate,
      observation: '',
      state: 'none',
      sensitive: false
    })
    expect(screen.queryByRole('button', { name: 'Create update' })).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Focus last reviewed')).toHaveTextContent(
      `Last reviewed · ${newDate}`
    )
    expect(listFocuses).toHaveBeenCalledTimes(2)
  })

  it('creates from a parent list and deep-links to the new Commitment', async () => {
    const current = focus()
    const created = commitment({
      id: 21,
      title: 'Publish the launch boundary',
      type: 'action',
      dueDate: '2026-09-15'
    })
    const createCommitment = vi.fn().mockResolvedValue(created)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      createCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    expect(screen.getByRole('navigation', { name: 'Focus sections' })).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Add commitment to Overall' })
    )
    const dialog = screen.getByRole('dialog', { name: 'New commitment' })
    expect(within(dialog).queryByLabelText('Type')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Title/), 'Publish the launch boundary')
    await user.type(within(dialog).getByLabelText(/Due date/), '2026-09-15')
    await user.click(screen.getByRole('button', { name: 'Create commitment' }))

    expect(createCommitment).toHaveBeenCalledWith({
      parent: { type: 'focus', id: 1 },
      type: 'action',
      title: 'Publish the launch boundary',
      dueDate: '2026-09-15'
    })
    const navigation = await screen.findByRole('navigation', { name: 'Focus sections' })
    expect(
      within(navigation).getByRole('button', {
        name: 'Open Overall commitment Publish the launch boundary'
      })
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'New thread' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Publish the launch boundary' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Commitment type')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Commitment due date')).toHaveValue('2026-09-15')
  })

  it('lists, edits, creates, and deletes visibly stateful Commitment updates', async () => {
    const current = focus()
    const focusCommitment = commitment()
    const existingUpdate = update()
    const editedUpdate = update({
      observation: 'Acceptance criteria improved',
      state: 'green'
    })
    const createdUpdate = update({
      id: 31,
      date: '2026-08-07',
      observation: '',
      state: 'none',
      sensitive: false
    })
    const updateUpdate = vi.fn().mockResolvedValue(editedUpdate)
    const createUpdate = vi.fn().mockResolvedValue(createdUpdate)
    const deleteUpdate = vi.fn().mockResolvedValue(true)
    const api = installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listCommitments: vi.fn().mockResolvedValue([focusCommitment]),
      listUpdates: vi.fn().mockResolvedValue([existingUpdate]),
      updateUpdate,
      createUpdate,
      deleteUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(
      await screen.findByRole('button', { name: 'Open commitment Keep sponsors aligned' })
    )
    const observation = await screen.findByLabelText('Update observation')
    expect(observation).toHaveTextContent('Ticket quality is uneven')
    expect(screen.getByText('Yellow', { selector: 'span' })).toBeInTheDocument()

    await user.type(observation, ' and acceptance criteria improved')
    await user.selectOptions(screen.getByLabelText('Update state'), 'green')
    expect(screen.queryByRole('button', { name: 'Save update' })).not.toBeInTheDocument()
    await waitFor(() => expect(updateUpdate).toHaveBeenCalled(), { timeout: 2_000 })
    const editInput = updateUpdate.mock.calls.at(-1)?.[1]
    expect(editInput).toMatchObject({ date: '2026-08-01', state: 'green' })
    expect(editInput.observation).toBeUndefined()
    const savedObservation = vi.mocked(api.richText.saveDocument).mock.calls.at(-1)?.[1] as string
    expect(isRichText(savedObservation)).toBe(true)
    expect(richTextPlainText(savedObservation)).toBe(
      ' and acceptance criteria improvedTicket quality is uneven'
    )
    expect(screen.getByText('Green', { selector: 'span' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    const createUpdateInput = createUpdate.mock.calls[0][0]
    expect(createUpdateInput).toMatchObject({
      parent: { type: 'commitment', id: 20 },
      date: expect.any(String),
      state: 'none'
    })
    expect(createUpdateInput.observation).toBe('')
    expect(await screen.findAllByLabelText('Update observation')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Create update' })).not.toBeInTheDocument()

    const existingCard = observation.closest<HTMLElement>('[role="listitem"]')
    expect(existingCard).not.toBeNull()
    await user.click(within(existingCard!).getByRole('button', { name: 'Delete update' }))
    expect(deleteUpdate).toHaveBeenCalledWith(30)
  })

  it('persists a blank Update immediately, then autosaves state and refreshes its Commitment row', async () => {
    const current = focus()
    const emptyCommitment = commitment()
    const blankCommitment = commitment({
      lastUpdateDate: '2026-08-07'
    })
    const redCommitment = commitment({
      state: 'red',
      lastUpdateDate: '2026-08-07'
    })
    const listCommitments = vi
      .fn()
      .mockResolvedValueOnce([emptyCommitment])
      .mockResolvedValueOnce([blankCommitment])
      .mockResolvedValue([redCommitment])
    const createUpdate = vi.fn().mockResolvedValue(
      update({
        date: '2026-08-07',
        observation: '',
        state: 'none'
      })
    )
    const updateUpdate = vi.fn().mockResolvedValue(
      update({
        date: '2026-08-07',
        observation: '',
        state: 'red'
      })
    )
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listCommitments,
      createUpdate,
      updateUpdate
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(
      await screen.findByRole('button', { name: 'Open commitment Keep sponsors aligned' })
    )
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(createUpdate).toHaveBeenCalledOnce())
    expect(createUpdate).toHaveBeenCalledWith({
      parent: { type: 'commitment', id: 20 },
      date: expect.any(String),
      observation: '',
      state: 'none',
      sensitive: false
    })
    await user.selectOptions(await screen.findByLabelText('Update state'), 'red')
    await waitFor(() => expect(updateUpdate).toHaveBeenCalledOnce(), { timeout: 2_000 })
    expect(updateUpdate).toHaveBeenCalledWith(30, {
      date: '2026-08-07',
      state: 'red',
      sensitive: false
    })
    const overallCommitments = screen.getByRole('list', {
      name: 'Overall Commitments'
    })
    expect(
      await within(overallCommitments).findByRole('img', { name: 'Red state' })
    ).toHaveAttribute('data-tone', 'danger')
    expect(
      within(overallCommitments).getByRole('button', {
        name: 'Open Overall commitment Keep sponsors aligned'
      })
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Commitment last updated')).toHaveTextContent(
      'Last updated · 2026-08-07'
    )

    await user.click(screen.getByRole('button', { name: 'Overall' }))
    const commitmentRow = screen
      .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
      .closest<HTMLElement>('[role="listitem"]')
    expect(commitmentRow).not.toBeNull()
    expect(within(commitmentRow!).getByText('Red', { selector: '[data-tone="danger"]' })).toBeVisible()
    expect(within(commitmentRow!).getByText('Last updated · 2026-08-07')).toBeVisible()
  })

  it('pins a commitment in the drawer across navigation without changing contextual selection', async () => {
    const current = focus({ title: 'Project Atlas' })
    const focusCommitment = commitment()
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listCommitments: vi.fn().mockResolvedValue([focusCommitment])
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'Pin commitment Keep sponsors aligned in context drawer'
      })
    )

    const commitmentDrawer = screen.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    expect(within(commitmentDrawer).getByRole('heading', { name: 'Commitment' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Project Atlas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('navigation', { name: 'Focus sections' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Focus commitments' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByRole('heading', { name: 'Todos' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Commitment context drawer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Unpin drawer and follow current selection' }))
    expect(screen.getByRole('complementary', { name: 'Context drawer' })).toBeInTheDocument()
  })

  it('keeps the drawer open and replaces its adapter across Focus, Thread, Commitment, and Todos', async () => {
    const current = focus({ title: 'Project Atlas', lastReviewDate: '2026-01-02' })
    const sprint = thread({ lastReviewDate: '2026-01-03' })
    const updatedSprint = thread({ lastReviewDate: '2026-01-03', needsReview: false })
    const focusCommitment = commitment()
    const updateThread = vi.fn().mockResolvedValue(updatedSprint)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      listCommitments: vi.fn().mockResolvedValue([focusCommitment]),
      updateThread
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    expect(screen.getByLabelText('Focus last reviewed')).toHaveTextContent(
      'Last reviewed · 2026-01-02'
    )
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    const focusDrawer = screen.getByRole('complementary', { name: 'Focus context drawer' })
    expect(focusDrawer).toBeInTheDocument()
    expect(within(focusDrawer).getByText('2026-01-02')).toBeInTheDocument()
    expect(within(focusDrawer).getByLabelText('Needs review')).toBeChecked()

    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    expect(screen.getByLabelText('Thread last reviewed')).toHaveTextContent(
      'Last reviewed · 2026-01-03'
    )
    const threadDrawer = screen.getByRole('complementary', { name: 'Thread context drawer' })
    expect(within(threadDrawer).getByRole('heading', { name: 'Thread' })).toBeInTheDocument()
    expect(within(threadDrawer).getByDisplayValue('Sprint execution')).toBeInTheDocument()
    expect(within(threadDrawer).getByText('2026-01-03')).toBeInTheDocument()
    await user.click(within(threadDrawer).getByLabelText('Needs review'))
    await user.click(within(threadDrawer).getByRole('button', { name: 'Save changes' }))
    expect(updateThread).toHaveBeenCalledWith(10, {
      title: 'Sprint execution',
      reviewFrequencyDays: 7,
      needsReview: false,
      sensitive: false
    })
    expect(within(threadDrawer).getByLabelText('Needs review')).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Overall' }))
    expect(screen.getByRole('complementary', { name: 'Focus context drawer' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open commitment Keep sponsors aligned' }))

    const commitmentDrawer = screen.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    expect(within(commitmentDrawer).getByRole('heading', { name: 'Commitment' })).toBeInTheDocument()
    expect(within(commitmentDrawer).getByDisplayValue('Keep sponsors aligned')).toBeInTheDocument()
    expect(within(commitmentDrawer).getByText('Last updated')).toBeInTheDocument()
    expect(within(commitmentDrawer).getByText('Never')).toBeInTheDocument()
    expect(screen.getByLabelText('Commitment last updated')).toHaveTextContent(
      'Last updated · Never'
    )

    await user.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByRole('complementary', { name: 'Context drawer' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize context drawer' })).toBeInTheDocument()
  })

  it('edits title, notes, and status in the contextual drawer', async () => {
    const current = focus({ description: 'Old notes' })
    const updated = focus({
      title: 'Revised plan',
      description: 'New notes',
      status: 'paused',
      needsReview: false
    })
    const updateFocus = vi.fn().mockResolvedValue(updated)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      updateFocus
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    expect(screen.getByRole('complementary', { name: 'Focus context drawer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close context drawer' })).toBeInTheDocument()

    const title = screen.getByLabelText(/^Title/)
    await user.clear(title)
    await user.type(title, 'Revised plan')
    const notes = screen.getByLabelText('Description / notes')
    await user.type(notes, ' plus new notes')
    await user.selectOptions(screen.getByLabelText('Status'), 'paused')
    await user.click(screen.getByLabelText('Needs review'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(updateFocus).toHaveBeenCalledOnce()
    const drawerInput = updateFocus.mock.calls[0][1]
    expect(drawerInput).toMatchObject({
      title: 'Revised plan',
      status: 'paused',
      needsReview: false
    })
    expect(isRichText(drawerInput.description)).toBe(true)
    expect(richTextPlainText(drawerInput.description)).toBe(' plus new notesOld notes')
    expect(await screen.findByRole('heading', { name: 'Revised plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revised plan, paused' })).toHaveClass('opacity-55')
  })

  it('keeps Focus and Thread title inputs focused across autosave refreshes', async () => {
    let currentFocus = focus({ title: 'Project Atlas' })
    let currentThread = thread({ title: 'Sprint execution' })
    let revision = 1
    const updateFocus = vi.fn(async (
      _focusId: number,
      input: Parameters<DomainApi['updateFocus']>[1]
    ) => {
      currentFocus = focus({
        ...currentFocus,
        ...input,
        updatedAt: `2026-01-01T00:00:0${revision++}.000Z`
      })
      return currentFocus
    })
    const updateThread = vi.fn(async (
      _threadId: number,
      input: Parameters<DomainApi['updateThread']>[1]
    ) => {
      currentThread = thread({
        ...currentThread,
        ...input,
        updatedAt: `2026-01-01T00:00:0${revision++}.000Z`
      })
      return currentThread
    })
    installApi({
      listFocuses: vi.fn().mockResolvedValue([currentFocus]),
      listThreads: vi.fn().mockResolvedValue([currentThread]),
      updateFocus,
      updateThread
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    const focusTitle = within(
      screen.getByRole('complementary', { name: 'Focus context drawer' })
    ).getByLabelText(/^Title/)
    focusTitle.focus()
    fireEvent.change(focusTitle, { target: { value: 'Project Atlas revised' } })
    await waitFor(() => expect(updateFocus).toHaveBeenCalledOnce(), { timeout: 2_000 })
    await screen.findByRole('heading', { name: 'Project Atlas revised' })
    expect(screen.getByLabelText(/^Title/)).toBe(focusTitle)
    expect(focusTitle).toHaveFocus()
    fireEvent.change(focusTitle, { target: { value: 'Project Atlas revised again' } })
    await waitFor(() => expect(updateFocus).toHaveBeenCalledTimes(2), { timeout: 2_000 })
    expect(focusTitle).toHaveValue('Project Atlas revised again')
    expect(focusTitle).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Sprint execution' }))
    const threadTitle = within(
      screen.getByRole('complementary', { name: 'Thread context drawer' })
    ).getByLabelText(/^Title/)
    threadTitle.focus()
    fireEvent.change(threadTitle, { target: { value: 'Sprint execution revised' } })
    await waitFor(() => expect(updateThread).toHaveBeenCalledOnce(), { timeout: 2_000 })
    await screen.findByRole('button', { name: 'Sprint execution revised' })
    expect(screen.getByLabelText(/^Title/)).toBe(threadTitle)
    expect(threadTitle).toHaveValue('Sprint execution revised')
    expect(threadTitle).toHaveFocus()
  })

  it('edits Thread cadence and Thread and Commitment titles through typed drawer fields', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread({ title: 'Sprint execution', reviewFrequencyDays: 7 })
    const focusCommitment = commitment({ title: 'Keep sponsors aligned' })
    const updateThread = vi.fn().mockResolvedValue(thread({
      title: 'Sprint reliability',
      reviewFrequencyDays: 14
    }))
    const updateCommitment = vi.fn().mockResolvedValue(commitment({
      title: 'Keep sponsors closely aligned',
      type: 'action',
      dueDate: '2026-09-15'
    }))
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [focusCommitment] : []
      ),
      updateThread,
      updateCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    let drawer = screen.getByRole('complementary', { name: 'Thread context drawer' })
    const threadTitle = within(drawer).getByLabelText(/^Title/)
    await user.clear(threadTitle)
    await user.type(threadTitle, 'Sprint reliability')
    const frequency = within(drawer).getByRole('spinbutton', {
      name: /^Review every \(days\)/
    })
    await user.clear(frequency)
    await user.type(frequency, '14')
    await user.click(within(drawer).getByRole('button', { name: 'Save changes' }))

    expect(updateThread).toHaveBeenCalledWith(sprint.id, {
      title: 'Sprint reliability',
      reviewFrequencyDays: 14,
      needsReview: true,
      sensitive: false
    })
    expect(await screen.findByRole('button', { name: 'Sprint reliability' })).toHaveAttribute(
      'aria-current',
      'page'
    )

    await user.click(screen.getByRole('button', { name: 'Overall' }))
    await user.click(screen.getByRole('button', {
      name: 'Open commitment Keep sponsors aligned'
    }))
    drawer = screen.getByRole('complementary', { name: 'Commitment context drawer' })
    const commitmentTitle = within(drawer).getByLabelText(/^Title/)
    await user.clear(commitmentTitle)
    await user.type(commitmentTitle, 'Keep sponsors closely aligned')
    await user.type(within(drawer).getByLabelText('Due date'), '2026-09-15')
    await user.click(within(drawer).getByRole('button', { name: 'Save changes' }))

    expect(updateCommitment).toHaveBeenCalledWith(focusCommitment.id, {
      title: 'Keep sponsors closely aligned',
      dueDate: '2026-09-15',
      type: 'action',
      sensitive: false
    })
    expect(await screen.findByRole('heading', { name: 'Keep sponsors closely aligned' }))
      .toBeInTheDocument()
  })

  it('confirms Thread and Commitment deletion and moves active routes to their parents', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread({ title: 'Sprint execution' })
    const focusCommitment = commitment({ title: 'Keep sponsors aligned' })
    const deleteThread = vi.fn().mockResolvedValue(true)
    const deleteCommitment = vi.fn().mockResolvedValue(true)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [focusCommitment] : []
      ),
      deleteThread,
      deleteCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog', { name: 'Delete thread?' })).toBeInTheDocument()
    expect(deleteThread).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete thread' }))

    expect(deleteThread).toHaveBeenCalledWith(sprint.id)
    expect(await screen.findByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.queryByRole('button', { name: 'Sprint execution' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Focus context drawer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', {
      name: 'Open commitment Keep sponsors aligned'
    }))
    expect(screen.getByRole('complementary', { name: 'Commitment context drawer' }))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog', { name: 'Delete commitment?' })).toBeInTheDocument()
    expect(deleteCommitment).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete commitment' }))

    expect(deleteCommitment).toHaveBeenCalledWith(focusCommitment.id)
    expect(await screen.findByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.queryByRole('button', {
      name: 'Open commitment Keep sponsors aligned'
    })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Focus context drawer' })).toBeInTheDocument()
  })

  it('preserves an unrelated active route when deleting a pinned Commitment', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread({ title: 'Sprint execution' })
    const focusCommitment = commitment({ title: 'Keep sponsors aligned' })
    const deleteCommitment = vi.fn().mockResolvedValue(true)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      listCommitments: vi.fn(async (parent) =>
        parent.type === 'focus' ? [focusCommitment] : []
      ),
      deleteCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', {
      name: 'Pin commitment Keep sponsors aligned in context drawer'
    }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    expect(screen.getByRole('complementary', { name: 'Commitment context drawer' }))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete commitment' }))

    expect(deleteCommitment).toHaveBeenCalledWith(focusCommitment.id)
    expect(screen.getByRole('button', { name: 'Sprint execution' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('complementary', { name: 'Thread context drawer' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unpin drawer and follow current selection' }))
      .not.toBeInTheDocument()
  })

  it('keeps the active Thread and drawer intact when Thread deletion fails', async () => {
    const current = focus({ title: 'Project Atlas' })
    const sprint = thread({ title: 'Sprint execution' })
    const deleteThread = vi.fn().mockResolvedValue(false)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      listThreads: vi.fn().mockResolvedValue([sprint]),
      deleteThread
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Project Atlas' }))
    await user.click(await screen.findByRole('button', { name: 'Sprint execution' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete thread' }))

    expect(deleteThread).toHaveBeenCalledWith(sprint.id)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The thread could not be deleted. Please try again.'
    )
    expect(screen.getByRole('button', { name: 'Sprint execution' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('complementary', { name: 'Thread context drawer' }))
      .toBeInTheDocument()
  })

  it('filters a newly cancelled or completed selection and redirects to Todos', async () => {
    const current = focus()
    const updateFocus = vi.fn().mockResolvedValue(focus({ status: 'done' }))
    installApi({ listFocuses: vi.fn().mockResolvedValue([current]), updateFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    await user.selectOptions(screen.getByLabelText('Status'), 'done')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { name: 'Todos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quarterly plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Focus context drawer' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Context drawer' })).toBeInTheDocument()
  })

  it('requires confirmation before deleting and redirects the selected focus to Todos', async () => {
    const current = focus({ title: 'Delete me' })
    const deleteFocus = vi.fn().mockResolvedValue(true)
    installApi({ listFocuses: vi.fn().mockResolvedValue([current]), deleteFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Delete me' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog', { name: 'Delete focus?' })).toBeInTheDocument()
    expect(deleteFocus).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete focus' }))

    expect(deleteFocus).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('heading', { name: 'Todos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete me' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Context drawer' })).toBeInTheDocument()
  })

  it('keeps the active view and drawer intact when deletion fails', async () => {
    const current = focus({ title: 'Still here' })
    const deleteFocus = vi.fn().mockResolvedValue(false)
    installApi({ listFocuses: vi.fn().mockResolvedValue([current]), deleteFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Still here' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete focus' }))

    expect(deleteFocus).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The focus could not be deleted. Please try again.'
    )
    expect(screen.getByRole('heading', { name: 'Still here' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Still here' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('complementary', { name: 'Focus context drawer' })).toBeInTheDocument()
  })

  it('keeps sidebar and contextual drawer resizing keyboard accessible', async () => {
    installApi()
    const user = userEvent.setup()
    render(<App />)

    const sidebar = screen.getByLabelText('Primary sidebar')
    const sidebarHandle = screen.getByRole('separator', { name: 'Resize sidebar' })
    expect(sidebar).toHaveStyle({ width: '248px' })
    fireEvent.keyDown(sidebarHandle, { key: 'ArrowRight' })
    expect(sidebar).toHaveStyle({ width: '264px' })

    const drawerToggle = await screen.findByRole('button', { name: 'Toggle context drawer' })
    expect(drawerToggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(drawerToggle)
    expect(drawerToggle).toHaveAttribute('aria-pressed', 'true')
    const drawer = screen.getByRole('complementary', { name: 'Context drawer' })
    const drawerHandle = screen.getByRole('separator', { name: 'Resize context drawer' })
    expect(drawer).toHaveStyle({ width: '336px' })
    fireEvent.keyDown(drawerHandle, { key: 'ArrowLeft' })
    expect(drawer).toHaveStyle({ width: '352px' })
    await user.click(drawerToggle)
    expect(drawerToggle).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.queryByRole('complementary', { name: 'Context drawer' })
    ).not.toBeInTheDocument()
    await user.click(drawerToggle)
    expect(screen.getByRole('complementary', { name: 'Context drawer' })).toHaveStyle({
      width: '352px'
    })
  })

  it('opens backup settings and runs named backup and storage actions from the footer', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<App />)

    const settings = await screen.findByRole('button', { name: 'Settings' })
    expect(settings).toBeEnabled()
    await user.click(settings)
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible()
    expect(settings).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Automatic database backups')).toBeVisible()
    expect(screen.getByText('1 of 10 snapshots')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Recent backups' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    expect(api.backups.createNow).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Show backups' }))
    expect(api.backups.showFolder).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Data & storage' }))
    expect(api.showDataFolder).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Todos' }))
    expect(await screen.findByRole('heading', { name: 'Todos' })).toBeVisible()
  })

  it('shows a useful error if focus storage fails to load', async () => {
    installApi({ listFocuses: vi.fn().mockRejectedValue(new Error('unavailable')) })
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local database could not be opened.'
    )
    expect(screen.getByRole('button', { name: 'Data & storage' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New focus' })).toBeDisabled()
  })

  it('surfaces create failures without closing the modal', async () => {
    installApi({ createFocus: vi.fn().mockRejectedValue(new Error('disk full')) })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'New focus' }))
    await user.type(screen.getByLabelText(/^Title/), 'Will fail')
    await user.click(screen.getByRole('button', { name: 'Create focus' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The focus could not be created. Please try again.'
    )
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New focus' })).toBeInTheDocument())
  })
})
