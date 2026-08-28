// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasEntityWidget } from '../../src/renderer/src/features/canvas/canvas-entity-widget'
import type { CanvasCardModel } from '../../src/renderer/src/features/canvas/canvas-presenters'

const model: CanvasCardModel = {
  kind: 'commitment',
  kindLabel: 'Commitment',
  title: 'Resolve rollout risks',
  status: 'Active',
  statusTone: 'warning',
  context: 'Mission Control › Launch readiness',
  facts: [
    { label: 'Due', value: 'Aug 30, 2026' },
    { label: 'State', value: 'Yellow', tone: 'warning' },
    { label: 'Last update', value: 'Aug 27, 2026' }
  ],
  preview: null,
  sensitive: true,
  deleted: false,
  deletedAt: null
}

describe('CanvasEntityWidget', () => {
  it('renders a shadcn-style semantic widget with hierarchy and relevant facts', () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    const onMovePointerDown = vi.fn()
    render(
      <CanvasEntityWidget
        model={model}
        onOpen={onOpen}
        onRemove={onRemove}
        onMovePointerDown={onMovePointerDown}
      />
    )

    expect(screen.getByRole('article', {
      name: 'Commitment: Resolve rollout risks'
    })).toHaveClass('rounded-xl', 'bg-card')
    expect(screen.getByText('Mission Control › Launch readiness')).toBeInTheDocument()
    expect(screen.getByText('Aug 30, 2026')).toBeInTheDocument()
    expect(screen.getByText('Yellow')).toBeInTheDocument()
    expect(screen.getByLabelText('Sensitive')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'Open Commitment Resolve rollout risks'
    }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Remove Resolve rollout risks from Canvas'
    }))
    fireEvent.pointerDown(screen.getByRole('article'), { button: 0, clientX: 40, clientY: 50 })
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onMovePointerDown).toHaveBeenCalledOnce()
  })

  it('keeps legacy small geometry readable and makes deleted widgets visibly inert', () => {
    const onRemove = vi.fn()
    const { rerender } = render(
      <CanvasEntityWidget model={model} compact onRemove={onRemove} />
    )
    expect(screen.queryByText('Mission Control › Launch readiness')).not.toBeInTheDocument()

    rerender(
      <CanvasEntityWidget
        model={{
          ...model,
          status: 'Deleted',
          statusTone: 'muted',
          deleted: true,
          deletedAt: '2026-08-28T12:00:00.000Z'
        }}
        onRemove={onRemove}
      />
    )
    expect(screen.getByRole('article')).toHaveClass('border-dashed', 'shadow-none')
    expect(screen.getByText('Previously in Mission Control › Launch readiness')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Commitment/ })).not.toBeInTheDocument()
  })
})
