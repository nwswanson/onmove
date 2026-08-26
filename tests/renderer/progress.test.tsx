// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Progress } from '../../src/renderer/src/components/ui/progress'

describe('Progress', () => {
  it('exposes determinate bounds, clamps the indicator, and preserves value text', () => {
    const { container } = render(
      <Progress
        value={15}
        max={10}
        aria-label="Current step"
        aria-valuetext="Indexing, 15 requested of 10 available"
      />
    )

    const progress = screen.getByRole('progressbar', { name: 'Current step' })
    expect(progress).toHaveAttribute('aria-valuemin', '0')
    expect(progress).toHaveAttribute('aria-valuemax', '10')
    expect(progress).toHaveAttribute('aria-valuenow', '10')
    expect(progress).toHaveAttribute(
      'aria-valuetext', 'Indexing, 15 requested of 10 available'
    )
    expect(container.querySelector('[data-slot="progress-indicator"]'))
      .toHaveStyle({ width: '100%' })
  })

  it('omits a current value and honors reduced motion when indeterminate', () => {
    const { container } = render(<Progress value={null} aria-label="Loading status" />)

    const progress = screen.getByRole('progressbar', { name: 'Loading status' })
    expect(progress).not.toHaveAttribute('aria-valuenow')
    expect(progress).toHaveAttribute('data-state', 'indeterminate')
    expect(container.querySelector('[data-slot="progress-indicator"]'))
      .toHaveClass('animate-pulse', 'motion-reduce:animate-none')
  })
})
