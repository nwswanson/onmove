// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
    render(<CanvasEntityWidget model={model} />)

    expect(screen.getByRole('article', {
      name: 'Commitment: Resolve rollout risks'
    })).toHaveClass('rounded-xl', 'bg-card')
    expect(screen.getByText('Mission Control › Launch readiness')).toBeInTheDocument()
    expect(screen.getByText('Aug 30, 2026')).toBeInTheDocument()
    expect(screen.getByText('Yellow')).toBeInTheDocument()
    expect(screen.getByLabelText('Sensitive')).toBeInTheDocument()
  })

  it('keeps legacy small geometry readable and makes deleted widgets visibly inert', () => {
    const { rerender } = render(<CanvasEntityWidget model={model} compact />)
    expect(screen.queryByText('Mission Control › Launch readiness')).not.toBeInTheDocument()

    rerender(<CanvasEntityWidget model={{
      ...model,
      status: 'Deleted',
      statusTone: 'muted',
      deleted: true,
      deletedAt: '2026-08-28T12:00:00.000Z'
    }} />)
    expect(screen.getByRole('article')).toHaveClass('border-dashed', 'shadow-none')
    expect(screen.getByText('Previously in Mission Control › Launch readiness')).toBeInTheDocument()
  })
})
