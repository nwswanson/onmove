// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppState,
  CommitmentSnapshot,
  DomainApi,
  FocusSnapshot,
  OnMoveApi,
  ThreadSnapshot
} from '../../src/shared/contracts'
import { App } from '../../src/renderer/src/App'

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
    statusChangedAt: '2026-01-01T00:00:00.000Z',
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
    reviewFrequencyDays: 7,
    lastReviewDate: null,
    nextReviewDate: '2026-01-08',
    needsReview: false,
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
    lastUpdateDate: null,
    nextUpdateDate: null,
    needsUpdate: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    setFocusStatus: vi.fn(),
    deleteFocus: vi.fn(),
    getFocusStatusHistory: vi.fn(),
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn(),
    listCommitments: vi.fn().mockResolvedValue([]),
    createCommitment: vi.fn(),
    ...domainOverrides
  }
  const api: OnMoveApi = {
    getAppState: vi.fn().mockResolvedValue(initialState),
    recordGreeting: vi.fn().mockResolvedValue(initialState),
    showDataFolder: vi.fn().mockResolvedValue(undefined),
    domain,
    ...apiOverrides
  }
  Object.defineProperty(window, 'onmove', { value: api, configurable: true })
  return api
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the toolbar and sidebar while SQLite and focuses load', () => {
    installApi({}, { getAppState: vi.fn(() => new Promise<AppState>(() => undefined)) })

    render(<App />)

    expect(screen.getByLabelText('Loading application')).toBeInTheDocument()
    expect(screen.getByLabelText('Primary sidebar')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Application toolbar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New focus' })).toBeDisabled()
  })

  it('starts on Home with focuses exposed directly beneath the Focuses label', async () => {
    installApi()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Focuses')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Focus' })).not.toBeInTheDocument()
    expect(screen.getByText('No focuses yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New focus' })).toBeEnabled()
  })

  it('creates and selects a persisted focus through the required-title modal', async () => {
    const created = focus({ id: 7, title: 'Launch focus', description: 'Supporting notes' })
    const createFocus = vi.fn().mockResolvedValue(created)
    installApi({ createFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'New focus' }))
    expect(screen.getByRole('dialog', { name: 'New focus' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create focus' })).toBeDisabled()

    await user.type(screen.getByLabelText(/^Title/), 'Launch focus')
    await user.type(screen.getByLabelText(/Description \/ notes/), 'Supporting notes')
    await user.click(screen.getByRole('button', { name: 'Create focus' }))

    expect(createFocus).toHaveBeenCalledWith({
      title: 'Launch focus',
      description: 'Supporting notes'
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

    await screen.findByRole('heading', { name: 'Home' })
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

  it('persists the Focus goal and drills into focus-level commitments', async () => {
    const current = focus({ goal: 'Deliver the release safely' })
    const updated = focus({ goal: 'Deliver predictable customer value' })
    const focusCommitment = commitment()
    const updateFocus = vi.fn().mockResolvedValue(updated)
    const listCommitments = vi.fn().mockResolvedValue([focusCommitment])
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      updateFocus,
      listCommitments
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    const goal = await screen.findByLabelText('Goal')
    expect(goal).toHaveValue('Deliver the release safely')
    await user.clear(goal)
    await user.type(goal, 'Deliver predictable customer value')
    fireEvent.blur(goal)
    await waitFor(() =>
      expect(updateFocus).toHaveBeenCalledWith(1, {
        goal: 'Deliver predictable customer value'
      })
    )
    expect(listCommitments).toHaveBeenCalledWith({ type: 'focus', id: 1 })

    await user.click(
      await screen.findByRole('button', { name: 'Open commitment Keep sponsors aligned' })
    )
    expect(screen.getByRole('navigation', { name: 'Focus commitments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep sponsors aligned' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('heading', { name: 'Keep sponsors aligned' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New thread' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New commitment' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to Focus sections' }))
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('button', { name: 'New thread' })).toBeInTheDocument()
  })

  it('creates and selects a title-only commitment from the drilled contextual level', async () => {
    const current = focus()
    const created = commitment({ id: 21, title: 'Publish the launch boundary' })
    const createCommitment = vi.fn().mockResolvedValue(created)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      createCommitment
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(screen.getByRole('button', { name: 'Commitments' }))
    expect(screen.getByRole('navigation', { name: 'Focus commitments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Commitments' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New commitment' }))
    await user.type(screen.getByLabelText(/^Title/), 'Publish the launch boundary')
    await user.click(screen.getByRole('button', { name: 'Create commitment' }))

    expect(createCommitment).toHaveBeenCalledWith({
      parent: { type: 'focus', id: 1 },
      type: 'ongoing',
      title: 'Publish the launch boundary'
    })
    expect(await screen.findByRole('button', { name: 'Publish the launch boundary' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('heading', { name: 'Publish the launch boundary' })).toBeInTheDocument()
  })

  it('edits title, notes, and status in the contextual drawer', async () => {
    const current = focus({ description: 'Old notes' })
    const updated = focus({ title: 'Revised plan', description: 'New notes', status: 'paused' })
    const updateFocus = vi.fn().mockResolvedValue(updated)
    installApi({
      listFocuses: vi.fn().mockResolvedValue([current]),
      updateFocus
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(screen.getByRole('button', { name: 'Open Focus context' }))
    expect(screen.getByRole('complementary', { name: 'Focus context drawer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close context drawer' })).toBeInTheDocument()

    const title = screen.getByLabelText(/^Title/)
    await user.clear(title)
    await user.type(title, 'Revised plan')
    const notes = screen.getByLabelText('Description / notes')
    await user.clear(notes)
    await user.type(notes, 'New notes')
    await user.selectOptions(screen.getByLabelText('Status'), 'paused')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(updateFocus).toHaveBeenCalledWith(1, {
      title: 'Revised plan',
      description: 'New notes',
      status: 'paused'
    })
    expect(await screen.findByRole('heading', { name: 'Revised plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revised plan, paused' })).toHaveClass('opacity-55')
  })

  it('filters a newly cancelled or completed selection and redirects to Home', async () => {
    const current = focus()
    const updateFocus = vi.fn().mockResolvedValue(focus({ status: 'done' }))
    installApi({ listFocuses: vi.fn().mockResolvedValue([current]), updateFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(screen.getByRole('button', { name: 'Open Focus context' }))
    await user.selectOptions(screen.getByLabelText('Status'), 'done')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quarterly plan' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('complementary', { name: 'Focus context drawer' })
    ).not.toBeInTheDocument()
  })

  it('requires confirmation before deleting and redirects the selected focus to Home', async () => {
    const current = focus({ title: 'Delete me' })
    const deleteFocus = vi.fn().mockResolvedValue(true)
    installApi({ listFocuses: vi.fn().mockResolvedValue([current]), deleteFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Delete me' }))
    await user.click(screen.getByRole('button', { name: 'Open Focus context' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog', { name: 'Delete focus?' })).toBeInTheDocument()
    expect(deleteFocus).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete focus' }))

    expect(deleteFocus).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete me' })).not.toBeInTheDocument()
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

    await user.click(await screen.findByRole('button', { name: 'Open Home context' }))
    const drawer = screen.getByRole('complementary', { name: 'Home item context drawer' })
    const drawerHandle = screen.getByRole('separator', { name: 'Resize context drawer' })
    expect(drawer).toHaveStyle({ width: '336px' })
    fireEvent.keyDown(drawerHandle, { key: 'ArrowLeft' })
    expect(drawer).toHaveStyle({ width: '352px' })
  })

  it('keeps Settings and data actions in the footer', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('button', { name: /Settings/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Data & storage' }))
    expect(api.showDataFolder).toHaveBeenCalledOnce()
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
