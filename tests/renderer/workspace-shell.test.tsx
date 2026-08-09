// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationShell, WorkspaceShell } from '../../src/renderer/src/components/ui/workspace-shell'

describe('workspace shells', () => {
  it('composes all four independent regions and delegates resizing', () => {
    const resizePrimary = vi.fn()
    const resizeContextual = vi.fn()

    const { container } = render(
      <ApplicationShell
        toolbar={<div>Toolbar region</div>}
        primarySidebar={<nav aria-label="Primary region">Primary</nav>}
        primarySidebarResize={{
          label: 'Resize primary region',
          value: 224,
          min: 208,
          max: 288,
          direction: 1,
          onChange: resizePrimary
        }}
      >
        <WorkspaceShell
          contextualSidebar={<nav aria-label="Contextual region">Contextual</nav>}
          contextualSidebarResize={{
            label: 'Resize contextual region',
            value: 240,
            min: 220,
            max: 320,
            direction: 1,
            onChange: resizeContextual
          }}
          tabBar={<nav aria-label="Context tabs">Tab region</nav>}
          main={<main>Main region</main>}
          drawer={<aside aria-label="Drawer region">Drawer</aside>}
        />
      </ApplicationShell>
    )

    expect(container.querySelector('[data-slot="application-shell"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="workspace-shell"]')).toBeInTheDocument()
    expect(screen.getByText('Toolbar region')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary region' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Contextual region' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Context tabs' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('Main region')
    expect(screen.getByRole('complementary', { name: 'Drawer region' })).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize primary region' }), {
      key: 'ArrowRight'
    })
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize contextual region' }), {
      key: 'ArrowRight'
    })

    expect(resizePrimary).toHaveBeenCalledWith(240)
    expect(resizeContextual).toHaveBeenCalledWith(256)
    expect(
      container.querySelector('[data-slot="workspace-main-column"]')
    ).toContainElement(screen.getByRole('main'))
    expect(
      container.querySelector('[data-slot="workspace-main-column"]')?.firstElementChild
    ).toBe(screen.getByRole('navigation', { name: 'Context tabs' }))
  })

  it('allows screens without contextual navigation or a drawer', () => {
    render(<WorkspaceShell main={<main>Minimal workspace</main>} />)

    expect(screen.getByRole('main')).toHaveTextContent('Minimal workspace')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})
