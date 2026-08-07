// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppState,
  DomainApi,
  FocusSnapshot,
  OnMoveApi
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
    status: 'active',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
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

  it('defaults to an undeletable Overall section and switches to Thread entry tools', async () => {
    installApi({
      listFocuses: vi.fn().mockResolvedValue([
        focus({ title: 'Deliver Project Atlas', description: 'Protect a predictable launch.' })
      ])
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Deliver Project Atlas' }))

    expect(screen.getByRole('heading', { name: 'Deliver Project Atlas' })).toBeInTheDocument()
    const toolbar = screen.getByRole('toolbar', { name: 'Application toolbar' })
    expect(screen.getByRole('main')).toContainElement(toolbar)
    expect(screen.getByLabelText('Primary sidebar')).not.toContainElement(toolbar)
    expect(screen.getByLabelText('Focus sidebar')).toBeInTheDocument()
    expect(screen.getByLabelText('Focus sidebar')).toHaveStyle({ width: '252px' })
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Focus sidebar' }), {
      key: 'ArrowRight'
    })
    expect(screen.getByLabelText('Focus sidebar')).toHaveStyle({ width: '268px' })
    expect(screen.getByRole('tablist', { name: 'Focus sections' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overall' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.queryByRole('button', { name: /delete overall/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Deliver Project Atlas description')).toHaveValue(
      'Protect a predictable launch.'
    )
    expect(screen.getByRole('heading', { name: 'Commitments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New commitment' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New update' })).toBeInTheDocument()
    expect(screen.queryByText('Current assessment')).not.toBeInTheDocument()
    expect(screen.queryByText('Current reality')).not.toBeInTheDocument()
    expect(screen.queryByText('Linked commitments')).not.toBeInTheDocument()
    expect(screen.queryByText('Independent views of success')).not.toBeInTheDocument()
    expect(screen.queryByText('Append-only')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Sprint execution, At risk' }))

    expect(screen.getByRole('tab', { name: 'Sprint execution, At risk' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('heading', { name: 'Sprint execution' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sprint execution description')).toHaveValue(
      'Keep sprint planning clear, timely, and predictable.'
    )
    expect(
      screen.getByLabelText('Commitment: Improve ticket quality before sprint planning')
    ).toBeInTheDocument()
  })

  it('supports inline adding, editing, and deleting prototype commitments and updates', async () => {
    installApi({ listFocuses: vi.fn().mockResolvedValue([focus()]) })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Quarterly plan' }))

    await user.click(screen.getByRole('button', { name: 'New commitment' }))
    const newCommitment = screen.getByLabelText('Commitment: Untitled')
    await user.type(newCommitment, 'Publish the readiness note')
    expect(newCommitment).toHaveValue('Publish the readiness note')

    await user.click(screen.getByRole('button', { name: 'New update' }))
    const newUpdate = screen.getByLabelText('Update: Untitled')
    await user.type(newUpdate, 'Sponsors confirmed the launch sequence')
    expect(newUpdate).toHaveValue('Sponsors confirmed the launch sequence')

    const existingUpdate = screen.getByLabelText(
      'Update: Sponsors accepted the release sequence; reliability scope remains open.'
    )
    await user.clear(existingUpdate)
    await user.type(existingUpdate, 'Reliability scope was resolved.')
    expect(existingUpdate).toHaveValue('Reliability scope was resolved.')

    await user.click(
      screen.getByRole('button', {
        name: 'Delete update The team reports sustainable workload for the current release slice.'
      })
    )
    expect(
      screen.queryByLabelText(
        'Update: The team reports sustainable workload for the current release slice.'
      )
    ).not.toBeInTheDocument()
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
