// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, DomainApi, OnMoveApi } from '../../src/shared/contracts'
import { App } from '../../src/renderer/src/App'

const initialState: AppState = {
  greeting: 'Hello, world.',
  greetingCount: 0,
  launchCount: 1,
  lastGreetingAt: null,
  databasePath: '/Users/test/Library/Application Support/OnMove/onmove.sqlite3'
}

function installApi(overrides: Partial<OnMoveApi> = {}): OnMoveApi {
  const domain: DomainApi = {
    createRelation: vi.fn(),
    deleteRelation: vi.fn(),
    createItem: vi.fn(),
    getItem: vi.fn(),
    deleteItem: vi.fn(),
    moveItem: vi.fn(),
    setItemRelation: vi.fn(),
    setItemStatus: vi.fn(),
    getItemStatusHistory: vi.fn()
  }
  const api: OnMoveApi = {
    getAppState: vi.fn().mockResolvedValue(initialState),
    recordGreeting: vi.fn().mockResolvedValue({
      ...initialState,
      greetingCount: 1,
      lastGreetingAt: '2026-01-01T00:00:00.000Z'
    }),
    showDataFolder: vi.fn().mockResolvedValue(undefined),
    domain,
    ...overrides
  }
  Object.defineProperty(window, 'onmove', { value: api, configurable: true })
  return api
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a loading view before SQLite responds', () => {
    installApi({ getAppState: vi.fn(() => new Promise<AppState>(() => undefined)) })

    render(<App />)

    expect(screen.getByLabelText('Loading application')).toBeInTheDocument()
    expect(screen.getByLabelText('Primary sidebar')).toBeInTheDocument()
  })

  it('renders the hello-world data returned by SQLite', async () => {
    installApi()

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Hello, world.' })).toBeInTheDocument()
    expect(screen.getByTestId('greeting-count')).toHaveTextContent('0')
    expect(screen.getByText('Opened 1 time')).toBeInTheDocument()
  })

  it('saves and displays a persistent hello', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Save a hello' }))

    expect(api.recordGreeting).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByTestId('greeting-count')).toHaveTextContent('1'))
  })

  it('asks Electron to reveal the database in Finder', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Show data in Finder' }))

    expect(api.showDataFolder).toHaveBeenCalledOnce()
  })

  it('shows a useful error if the database fails to load', async () => {
    installApi({ getAppState: vi.fn().mockRejectedValue(new Error('unavailable')) })

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local database could not be opened.'
    )
  })

  it('keeps the current count and reports an error if saving fails', async () => {
    installApi({ recordGreeting: vi.fn().mockRejectedValue(new Error('disk full')) })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Save a hello' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your greeting could not be saved. Please try again.'
    )
    expect(screen.getByTestId('greeting-count')).toHaveTextContent('0')
  })
})
