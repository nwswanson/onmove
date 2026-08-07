// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextDrawer,
  ContextDrawerOutlet,
  type ContextDrawerAdapter
} from '../../src/renderer/src/components/ui/context-drawer'

function adapter(id: string, title: string): ContextDrawerAdapter {
  return {
    id,
    render: ({ width, onClose }) => (
      <ContextDrawer
        title={title}
        aria-label={`${title} drawer`}
        style={{ width }}
        onClose={onClose}
      >
        <p>{title} settings</p>
      </ContextDrawer>
    )
  }
}

describe('ContextDrawerOutlet', () => {
  it('renders the shared empty representation when an active screen has no adapter', async () => {
    const onClose = vi.fn()
    const onWidthChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextDrawerOutlet
        open
        adapter={null}
        overrideAdapter={null}
        width={320}
        minWidth={280}
        maxWidth={384}
        onWidthChange={onWidthChange}
        onClose={onClose}
        onClearOverride={vi.fn()}
      />
    )

    expect(screen.getByRole('complementary', { name: 'Context drawer' })).toHaveStyle({
      width: '320px'
    })
    expect(screen.getByText('No settings here.')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize context drawer' }), {
      key: 'ArrowLeft'
    })
    expect(onWidthChange).toHaveBeenCalledWith(336)
    await user.click(screen.getByRole('button', { name: 'Close context drawer' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('replaces screen-owned adapters without owning or closing persistent open state', () => {
    const sharedProps = {
      open: true,
      width: 336,
      minWidth: 280,
      maxWidth: 384,
      onWidthChange: vi.fn(),
      onClose: vi.fn(),
      overrideAdapter: null,
      onClearOverride: vi.fn()
    }
    const { rerender } = render(
      <ContextDrawerOutlet adapter={adapter('focus:1', 'Focus')} {...sharedProps} />
    )

    expect(screen.getByRole('complementary', { name: 'Focus drawer' })).toBeInTheDocument()
    rerender(<ContextDrawerOutlet adapter={adapter('thread:1', 'Thread')} {...sharedProps} />)

    expect(screen.queryByRole('complementary', { name: 'Focus drawer' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Thread drawer' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize context drawer' })).toBeInTheDocument()
    expect(sharedProps.onClose).not.toHaveBeenCalled()
  })

  it('renders nothing while the persistent outlet is closed', () => {
    render(
      <ContextDrawerOutlet
        open={false}
        adapter={adapter('focus:1', 'Focus')}
        overrideAdapter={null}
        width={336}
        minWidth={280}
        maxWidth={384}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onClearOverride={vi.fn()}
      />
    )

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('temporarily renders an override and can return to the active screen adapter', async () => {
    const onClearOverride = vi.fn()
    const user = userEvent.setup()
    const props = {
      open: true,
      adapter: adapter('focus:1', 'Focus'),
      overrideAdapter: adapter('commitment:2', 'Commitment'),
      width: 336,
      minWidth: 280,
      maxWidth: 384,
      onWidthChange: vi.fn(),
      onClose: vi.fn(),
      onClearOverride
    }
    const { rerender } = render(<ContextDrawerOutlet {...props} />)

    expect(screen.getByRole('complementary', { name: 'Commitment drawer' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Focus drawer' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Return drawer to current selection' }))
    expect(onClearOverride).toHaveBeenCalledOnce()

    rerender(
      <ContextDrawerOutlet
        {...props}
        adapter={adapter('thread:3', 'Thread')}
      />
    )
    expect(onClearOverride).toHaveBeenCalledTimes(2)
  })
})
