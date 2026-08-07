// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppState,
  CommitmentSnapshot,
  DomainApi,
  FocusSnapshot,
  OnMoveApi,
  ThreadSnapshot,
  UpdateSnapshot
} from '../../src/shared/contracts'
import { App } from '../../src/renderer/src/App'
import {
  isRichText,
  richTextPlainText
} from '../../src/renderer/src/components/ui/rich-text-editor'

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
    lastReviewDate: null,
    needsReview: true,
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
    needsReview: true,
    reviewDue: false,
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

function update(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    id: 30,
    parent: { type: 'commitment', id: 20 },
    date: '2026-08-01',
    observation: 'Ticket quality is uneven',
    state: 'yellow',
    createdAt: '2026-08-01T12:00:00.000Z',
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
    updateThread: vi.fn(),
    listCommitments: vi.fn().mockResolvedValue([]),
    createCommitment: vi.fn(),
    updateCommitment: vi.fn(),
    listUpdates: vi.fn().mockResolvedValue([]),
    createUpdate: vi.fn(),
    updateUpdate: vi.fn(),
    deleteUpdate: vi.fn(),
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
    const focusCommitment = commitment({ state: 'red', lastUpdateDate: '2026-01-04' })
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
    expect(goal).toHaveTextContent('Deliver the release safely')
    await user.type(goal, ' and predictably')
    await waitFor(() => expect(updateFocus).toHaveBeenCalledOnce(), { timeout: 2_000 })
    const goalInput = updateFocus.mock.calls[0][1].goal
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
    expect(screen.getByRole('navigation', { name: 'Focus commitments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep sponsors aligned' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('heading', { name: 'Keep sponsors aligned' })).toBeInTheDocument()
    expect(screen.getByLabelText('Commitment last updated')).toHaveTextContent(
      'Last updated · 2026-01-04'
    )
    expect(
      within(screen.getByRole('navigation', { name: 'Focus commitments' })).getByText(
        'Active · Last updated · 2026-01-04'
      )
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
      screen.getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
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
    const closedList = screen.getByRole('list', { name: 'Done and cancelled commitments' })
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
      'Paused item',
      'Done item',
      'Cancelled item'
    ])
    expect(
      within(navigation).getByText('Active', { selector: '[data-slot="sidebar-group-label"]' })
    ).toBeVisible()
    expect(
      within(navigation).getByText('Paused', { selector: '[data-slot="sidebar-group-label"]' })
    ).toBeVisible()
    expect(
      within(navigation).getByText('Done / Cancelled', {
        selector: '[data-slot="sidebar-group-label"]'
      })
    ).toBeVisible()
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
      state: 'none'
    })
    expect(screen.queryByRole('button', { name: 'Create update' })).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Focus last reviewed')).toHaveTextContent(
      `Last reviewed · ${newDate}`
    )
    expect(listFocuses).toHaveBeenCalledTimes(2)
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
      state: 'none'
    })
    const updateUpdate = vi.fn().mockResolvedValue(editedUpdate)
    const createUpdate = vi.fn().mockResolvedValue(createdUpdate)
    const deleteUpdate = vi.fn().mockResolvedValue(true)
    installApi({
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
    expect(isRichText(editInput.observation)).toBe(true)
    expect(richTextPlainText(editInput.observation)).toBe(
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
      state: 'none'
    })
    await user.selectOptions(await screen.findByLabelText('Update state'), 'red')
    await waitFor(() => expect(updateUpdate).toHaveBeenCalledOnce(), { timeout: 2_000 })
    expect(updateUpdate).toHaveBeenCalledWith(30, {
      date: '2026-08-07',
      observation: '',
      state: 'red'
    })
    const commitmentNavigation = screen.getByRole('navigation', {
      name: 'Focus commitments'
    })
    expect(
      await within(commitmentNavigation).findByText('Red', {
        selector: '[data-tone="danger"]'
      })
    ).toBeVisible()
    expect(
      await within(commitmentNavigation).findByText('Active · Last updated · 2026-08-07')
    ).toBeVisible()
    expect(screen.getByLabelText('Commitment last updated')).toHaveTextContent(
      'Last updated · 2026-08-07'
    )

    await user.click(screen.getByRole('button', { name: 'Back to Focus sections' }))
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

    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Commitment context drawer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Unpin drawer and follow current selection' }))
    expect(screen.getByRole('complementary', { name: 'Home item context drawer' })).toBeInTheDocument()
  })

  it('keeps the drawer open and replaces its adapter across Focus, Thread, Commitment, and Home', async () => {
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
    expect(within(threadDrawer).getAllByText('Sprint execution')).toHaveLength(2)
    expect(within(threadDrawer).getByText('2026-01-03')).toBeInTheDocument()
    await user.click(within(threadDrawer).getByLabelText('Needs review'))
    await user.click(within(threadDrawer).getByRole('button', { name: 'Save changes' }))
    expect(updateThread).toHaveBeenCalledWith(10, { needsReview: false })
    expect(within(threadDrawer).getByLabelText('Needs review')).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Overall' }))
    expect(screen.getByRole('complementary', { name: 'Focus context drawer' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open commitment Keep sponsors aligned' }))

    const commitmentDrawer = screen.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    expect(within(commitmentDrawer).getByRole('heading', { name: 'Commitment' })).toBeInTheDocument()
    expect(within(commitmentDrawer).getAllByText('Keep sponsors aligned')).toHaveLength(2)
    expect(within(commitmentDrawer).getByText('Last updated')).toBeInTheDocument()
    expect(within(commitmentDrawer).getByText('Never')).toBeInTheDocument()
    expect(screen.getByLabelText('Commitment last updated')).toHaveTextContent(
      'Last updated · Never'
    )

    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('complementary', { name: 'Home item context drawer' })).toBeInTheDocument()
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

  it('filters a newly cancelled or completed selection and redirects to Home', async () => {
    const current = focus()
    const updateFocus = vi.fn().mockResolvedValue(focus({ status: 'done' }))
    installApi({ listFocuses: vi.fn().mockResolvedValue([current]), updateFocus })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))
    await user.click(screen.getByRole('button', { name: 'Toggle context drawer' }))
    await user.selectOptions(screen.getByLabelText('Status'), 'done')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quarterly plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Focus context drawer' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Home item context drawer' })).toBeInTheDocument()
  })

  it('requires confirmation before deleting and redirects the selected focus to Home', async () => {
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
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete me' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Home item context drawer' })).toBeInTheDocument()
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
    const drawer = screen.getByRole('complementary', { name: 'Home item context drawer' })
    const drawerHandle = screen.getByRole('separator', { name: 'Resize context drawer' })
    expect(drawer).toHaveStyle({ width: '336px' })
    fireEvent.keyDown(drawerHandle, { key: 'ArrowLeft' })
    expect(drawer).toHaveStyle({ width: '352px' })
    await user.click(drawerToggle)
    expect(drawerToggle).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.queryByRole('complementary', { name: 'Home item context drawer' })
    ).not.toBeInTheDocument()
    await user.click(drawerToggle)
    expect(screen.getByRole('complementary', { name: 'Home item context drawer' })).toHaveStyle({
      width: '352px'
    })
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
