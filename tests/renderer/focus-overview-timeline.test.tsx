// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  FocusOverviewTimeline,
  type FocusOverviewTimelineModel
} from '../../src/renderer/src/features/focus/focus-overview-timeline'

const model: FocusOverviewTimelineModel = {
  threads: [
    { id: 1, title: 'Delivery', statusLabel: 'Active', closed: false },
    { id: 2, title: 'Discovery', statusLabel: 'Done', closed: true }
  ],
  updates: [
    {
      id: 10,
      threadId: 1,
      date: '2026-08-18',
      dateLabel: 'Aug 18, 2026',
      observation: 'The complete delivery update contains detail that belongs in the popup.',
      preview: 'The complete delivery update…',
      sourceLabel: 'Thread update',
      state: { label: 'Green', tone: 'success' }
    },
    {
      id: 11,
      threadId: 2,
      date: '2026-08-18',
      dateLabel: 'Aug 18, 2026',
      observation: 'Discovery is complete.',
      preview: 'Discovery is complete.',
      sourceLabel: 'Validate demand',
      state: { label: 'Yellow', tone: 'warning' }
    }
  ]
}

describe('FocusOverviewTimeline', () => {
  it('places parallel rails centrally and balances same-day bubbles across both sides', () => {
    render(<FocusOverviewTimeline model={model} onOpenThread={vi.fn()} />)
    const firstRailX = Number(screen.getByTestId('thread-rail-1').getAttribute('x1'))
    const secondRailX = Number(screen.getByTestId('thread-rail-2').getAttribute('x1'))
    const bubbles = screen.getAllByRole('button', { name: /^Read / })

    expect(firstRailX).toBeLessThan(secondRailX)
    expect(new Set(bubbles.map((bubble) => bubble.getAttribute('data-side')))).toEqual(
      new Set(['left', 'right'])
    )
    expect(screen.getAllByText('Aug 18, 2026')).toHaveLength(2)
  })

  it('shows compact bubbles, opens the full update, and links to the owning Thread', async () => {
    const onOpenThread = vi.fn()
    const user = userEvent.setup()
    render(<FocusOverviewTimeline model={model} onOpenThread={onOpenThread} />)

    expect(screen.getByRole('img', { name: 'Thread update timeline' })).toBeVisible()
    expect(screen.getByTestId('thread-rail-1')).toBeInTheDocument()
    expect(screen.getByTestId('thread-rail-2')).toBeInTheDocument()
    expect(screen.getByText('The complete delivery update…')).toBeVisible()
    expect(screen.queryByText(
      'The complete delivery update contains detail that belongs in the popup.'
    )).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', {
      name: 'Read Thread update from Aug 18, 2026'
    }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The complete delivery update contains detail that belongs in the popup.'
    )

    await user.click(screen.getByRole('button', { name: 'Open Thread' }))
    expect(onOpenThread).toHaveBeenCalledWith(1)
  })
})
