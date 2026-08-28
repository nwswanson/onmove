// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EntityLibrarySidebar } from '../../src/renderer/src/components/ui/entity-library-sidebar'

const groups = [{
  id: 'threads',
  label: 'Threads',
  items: [
    {
      id: 'thread:1',
      label: 'Delivery confidence',
      description: 'Project Atlas',
      status: 'active',
      icon: 'thread' as const
    },
    {
      id: 'thread:2',
      label: 'Archived launch',
      description: 'Project Nova',
      status: 'done',
      icon: 'thread' as const,
      disabled: true
    }
  ]
}, {
  id: 'notes',
  label: 'Notes',
  items: [{
    id: 'note:4',
    label: 'Default',
    description: 'Project Atlas › Delivery confidence',
    status: 'No status',
    icon: 'note' as const
  }]
}]

describe('EntityLibrarySidebar', () => {
  it('searches labels and hierarchy context while preserving partitions', () => {
    render(
      <EntityLibrarySidebar
        title="Default Canvas"
        groups={groups}
        width={280}
        onDragStart={vi.fn()}
      />
    )

    expect(screen.getByText('Threads')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Canvas items' }), {
      target: { value: 'Project Nova' }
    })
    expect(screen.getByText('Archived launch')).toBeInTheDocument()
    expect(screen.queryByText('Delivery confidence')).not.toBeInTheDocument()
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })

  it('hands the receiver a native drag transfer and prevents placed rows from dragging', () => {
    const onDragStart = vi.fn()
    render(
      <EntityLibrarySidebar
        title="Default Canvas"
        groups={groups}
        width={280}
        onDragStart={onDragStart}
      />
    )
    const dataTransfer = {} as DataTransfer
    fireEvent.dragStart(screen.getByRole('button', {
      name: 'Delivery confidence, Project Atlas, active, drag onto Canvas'
    }), { dataTransfer })
    expect(onDragStart).toHaveBeenCalledWith('thread:1', dataTransfer)
    expect(screen.getByRole('button', {
      name: 'Archived launch, Project Nova, done, already on Canvas'
    })).toBeDisabled()
  })
})
