// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
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

  it('opens on Home with the active sidebar item marked as the current page', async () => {
    installApi()

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Portfolio' })).not.toHaveAttribute('aria-current')
    expect(screen.getByText('Your home view is ready for its first items.')).toBeInTheDocument()
  })

  it('changes the main view when Portfolio and Home are selected', async () => {
    installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Portfolio' }))

    expect(screen.getByRole('heading', { name: 'Portfolio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Portfolio' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByText('Your portfolio is ready for its first collection.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('asks Electron to reveal the database in Finder', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Data & storage' }))

    expect(api.showDataFolder).toHaveBeenCalledOnce()
  })

  it('anchors settings and database health controls in the sidebar footer', async () => {
    installApi()
    render(<App />)

    expect(await screen.findByRole('button', { name: /Settings/ })).toBeDisabled()
    expect(screen.getByTestId('local-data-status')).toHaveTextContent('Local data ready')
    expect(screen.getByTestId('launch-count')).toHaveTextContent('1')
  })

  it('shows a useful error if the database fails to load', async () => {
    installApi({ getAppState: vi.fn().mockRejectedValue(new Error('unavailable')) })

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local database could not be opened.'
    )
    expect(screen.getByTestId('local-data-status')).toHaveTextContent('Local data unavailable')
    expect(screen.getByRole('button', { name: 'Data & storage' })).toBeDisabled()
  })
})
