// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  FocusOverviewTimeline,
  type FocusOverviewTimelineModel
} from '../../src/renderer/src/features/focus/focus-overview-timeline'
import { focusTimelineThreadColors } from '../../src/renderer/src/features/focus/focus-timeline-colors'

const model: FocusOverviewTimelineModel = {
  threads: [
    {
      id: 1,
      title: 'Delivery',
      statusLabel: 'Active',
      closed: false,
      tracks: [
        { subjectId: 101, name: 'North region' },
        { subjectId: 102, name: 'South region' }
      ]
    },
    {
      id: 2,
      title: 'Discovery',
      statusLabel: 'Done',
      closed: true,
      tracks: [{ subjectId: null, name: 'Thread-wide' }]
    }
  ],
  updates: [
    {
      id: 9,
      threadId: 1,
      subjectId: 101,
      subjectName: 'North region',
      date: '2026-08-12',
      dateLabel: 'Aug 12, 2026',
      observation: 'Delivery was blocked.',
      preview: 'Delivery was blocked.',
      sourceLabel: 'Delivery',
      sourceKind: 'thread',
      state: { label: 'Red', tone: 'danger' }
    },
    {
      id: 10,
      threadId: 1,
      subjectId: 102,
      subjectName: 'South region',
      date: '2026-08-18',
      dateLabel: 'Aug 18, 2026',
      observation: 'The complete delivery update contains detail that belongs in the popup.',
      preview: 'The complete delivery update…',
      sourceLabel: 'Delivery',
      sourceKind: 'thread',
      state: { label: 'Green', tone: 'success' }
    },
    {
      id: 11,
      threadId: 2,
      subjectId: null,
      subjectName: 'Thread-wide',
      date: '2026-08-18',
      dateLabel: 'Aug 18, 2026',
      observation: 'Discovery is complete.',
      preview: 'Discovery is complete.',
      sourceLabel: 'Discovery › Validate demand',
      sourceKind: 'commitment',
      state: { label: 'Yellow', tone: 'warning' }
    }
  ]
}

describe('FocusOverviewTimeline', () => {
  it('assigns stable, non-duplicated identity colors independent of Thread order', () => {
    const threads = Array.from({ length: 24 }, (_, index) => ({
      id: index + 1,
      title: `Thread ${index + 1}`,
      statusLabel: 'Active',
      closed: false,
      tracks: [{ subjectId: null, name: 'Thread-wide' }]
    }))
    const colors = focusTimelineThreadColors(threads)
    const reorderedColors = focusTimelineThreadColors([...threads].reverse())

    expect(new Set(colors.values())).toHaveLength(threads.length)
    for (const thread of threads) {
      expect(reorderedColors.get(thread.id)).toBe(colors.get(thread.id))
    }
  })

  it('measures the timeline when async Threads first mount instead of stretching its fallback SVG', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 720,
      bottom: 500,
      width: 720,
      height: 500,
      toJSON: () => ({})
    })
    try {
      const { rerender } = render(
        <FocusOverviewTimeline model={{ threads: [], updates: [] }} onOpenThread={vi.fn()} />
      )

      rerender(<FocusOverviewTimeline model={model} onOpenThread={vi.fn()} />)
      const timeline = screen.getByTestId('focus-thread-timeline')
      const svg = screen.getByRole('img', { name: 'Thread update timeline' })
      expect(timeline).not.toHaveClass('invisible')
      expect(svg.getAttribute('viewBox')?.split(' ')[2]).toBe('720')
      expect(svg).not.toHaveAttribute('preserveAspectRatio', 'none')

      rerender(<FocusOverviewTimeline model={{ threads: [], updates: [] }} onOpenThread={vi.fn()} />)
      rerender(<FocusOverviewTimeline model={model} onOpenThread={vi.fn()} />)
      expect(screen.getByRole('img', { name: 'Thread update timeline' })
        .getAttribute('viewBox')?.split(' ')[2]).toBe('720')
    } finally {
      rect.mockRestore()
    }
  })

  it('keeps close parallel rails sticky, colors state intervals, and puts every bubble left', () => {
    render(<FocusOverviewTimeline model={model} onOpenThread={vi.fn()} />)
    const firstThreadRails = screen.getAllByTestId('thread-rail-1')
    const secondThreadRails = screen.getAllByTestId('thread-rail-2')
    const northRail = firstThreadRails.find((rail) => rail.dataset.subjectId === '101')!
    const southRail = firstThreadRails.find((rail) => rail.dataset.subjectId === '102')!
    const northRailX = Number(northRail.getAttribute('x1'))
    const southRailX = Number(southRail.getAttribute('x1'))
    const secondRailX = Number(secondThreadRails[0]?.getAttribute('x1'))
    const bubbles = screen.getAllByRole('button', { name: /^Read / })

    expect(southRailX - northRailX).toBeGreaterThanOrEqual(3)
    expect(southRailX - northRailX).toBeLessThanOrEqual(6)
    expect(secondRailX - southRailX).toBeLessThanOrEqual(46)
    expect(new Set(bubbles.map((bubble) => bubble.getAttribute('data-side')))).toEqual(
      new Set(['left'])
    )
    expect(firstThreadRails.map((rail) => rail.getAttribute('data-state'))).toEqual([
      'red',
      'none',
      'green',
      'none'
    ])
    expect(northRail.querySelector('title')).toHaveTextContent('North region')
    expect(southRail.querySelector('title')).toHaveTextContent('South region')
    expect(screen.queryByRole('button', { name: 'North region timeline rail' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'Read Delivery update from Aug 12, 2026'
    })).toHaveAttribute('data-subject-id', '101')
    expect(screen.getByRole('button', {
      name: 'Read Delivery update from Aug 18, 2026'
    })).toHaveAttribute('data-subject-id', '102')
    expect(screen.getByTestId('timeline-sticky-thread-headers')).toHaveClass('sticky')
    expect(screen.getAllByText('Aug 18, 2026')).toHaveLength(1)
    expect(bubbles.at(-1)).toHaveAccessibleName('Read Delivery update from Aug 12, 2026')
  })

  it('keeps filtered rails in place while hiding their update evidence', async () => {
    const user = userEvent.setup()
    render(<FocusOverviewTimeline model={model} onOpenThread={vi.fn()} />)

    const deliveryFilter = screen.getByRole('button', { name: 'Delivery timeline rail' })
    expect(deliveryFilter).toHaveAttribute('aria-pressed', 'true')
    const deliveryColor = deliveryFilter.getAttribute('data-thread-color')
    const discoveryColor = screen.getByRole('button', {
      name: 'Discovery timeline rail'
    }).getAttribute('data-thread-color')
    expect(deliveryColor).toBeTruthy()
    expect(deliveryColor).not.toBe(discoveryColor)
    expect(screen.getByRole('button', {
      name: 'Read Delivery update from Aug 18, 2026'
    })).toHaveAttribute('data-thread-color', deliveryColor)
    expect(screen.getByRole('button', {
      name: 'Open Thread Delivery'
    })).toHaveAttribute('data-thread-color', deliveryColor)
    expect(screen.getByText('Delivery was blocked.')).toBeVisible()
    expect(screen.getByText('The complete delivery update…')).toBeVisible()

    await user.click(deliveryFilter)

    expect(deliveryFilter).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Delivery was blocked.')).not.toBeInTheDocument()
    expect(screen.queryByText('The complete delivery update…')).not.toBeInTheDocument()
    expect(screen.getByText('Discovery is complete.')).toBeVisible()
    expect(screen.getAllByTestId('thread-rail-1')).toHaveLength(2)
    for (const rail of screen.getAllByTestId('thread-rail-1')) {
      expect(rail).toHaveAttribute('data-filtered', 'true')
      expect(rail).toHaveClass('stroke-muted-foreground/30')
    }

    await user.click(deliveryFilter)

    expect(deliveryFilter).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Delivery was blocked.')).toBeVisible()
    expect(screen.getByText('The complete delivery update…')).toBeVisible()
  })

  it('shows compact bubbles, opens the full update, and links to the owning Thread', async () => {
    const onOpenThread = vi.fn()
    const user = userEvent.setup()
    render(<FocusOverviewTimeline model={model} onOpenThread={onOpenThread} />)

    expect(screen.getByRole('img', { name: 'Thread update timeline' })).toBeVisible()
    expect(screen.getAllByTestId('thread-rail-1').length).toBeGreaterThan(1)
    expect(screen.getAllByTestId('thread-rail-2').length).toBeGreaterThan(1)
    expect(screen.getByText('The complete delivery update…')).toBeVisible()
    expect(screen.queryByText(
      'The complete delivery update contains detail that belongs in the popup.'
    )).not.toBeInTheDocument()

    const deliveryUpdate = screen.getByRole('button', {
      name: 'Read Delivery update from Aug 18, 2026'
    })
    expect(within(deliveryUpdate).getByRole('img', { name: 'Thread type' })).toBeVisible()
    expect(within(screen.getByRole('button', {
      name: 'Read Discovery › Validate demand update from Aug 18, 2026'
    })).getByRole('img', { name: 'Commitment type' })).toBeVisible()

    await user.click(deliveryUpdate)
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The complete delivery update contains detail that belongs in the popup.'
    )

    await user.click(screen.getByRole('button', { name: 'Open Thread' }))
    expect(onOpenThread).toHaveBeenCalledWith(1)
  })
})
