// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VerticalSplitPane } from '../../src/renderer/src/components/ui/vertical-split-pane'

describe('vertical split pane', () => {
  it('resizes its top region with the keyboard and exposes receiver-owned semantics', () => {
    const { container } = render(
      <VerticalSplitPane
        separatorLabel="Resize working regions"
        primary={<section>Primary work</section>}
        secondary={<section>Secondary work</section>}
      />
    )

    const separator = screen.getByRole('separator', { name: 'Resize working regions' })
    const primary = container.querySelector('[data-slot="vertical-split-pane-primary"]')
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    expect(separator).toHaveAttribute('aria-valuenow', '62')
    expect(primary).toHaveStyle({ flexBasis: '62%' })

    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(separator).toHaveAttribute('aria-valuenow', '67')
    expect(primary).toHaveStyle({ flexBasis: '67%' })

    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    expect(separator).toHaveAttribute('aria-valuenow', '62')
  })

  it('tracks pointer movement and clamps the divider to usable panes', () => {
    const { container } = render(
      <VerticalSplitPane
        separatorLabel="Resize working regions"
        primary={<section>Primary work</section>}
        secondary={<section>Secondary work</section>}
      />
    )
    const root = container.querySelector('[data-slot="vertical-split-pane"]') as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 500,
      width: 800,
      height: 500,
      toJSON: () => ({})
    })
    const separator = screen.getByRole('separator', { name: 'Resize working regions' })

    fireEvent(separator, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientY: 300
    }))
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, clientY: 800 }))
    expect(separator).toHaveAttribute('aria-valuenow', '78')
    fireEvent(window, new MouseEvent('pointerup', { bubbles: true }))
  })
})
