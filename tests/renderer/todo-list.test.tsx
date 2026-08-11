// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodoList } from '../../src/renderer/src/features/todos/todo-list'

describe('TodoList', () => {
  it('creates, edits, completes, deletes, and reorders accessible due-date rows', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onReorder = vi.fn().mockResolvedValue(undefined)
    render(
      <TodoList
        ariaLabel="Thread Todos"
        items={[
          {
            id: '1',
            name: 'Overdue review',
            dueDate: '2026-08-01',
            done: false,
            overdue: true,
            contextLabel: 'Customer Operations'
          },
          {
            id: '2',
            name: 'Prepare notes',
            dueDate: null,
            done: false,
            overdue: false
          }
        ]}
        createTargets={[
          { id: 'customer', label: 'Customer Operations' },
          { id: 'platform', label: 'Platform Team' }
        ]}
        defaultCreateTargetId="customer"
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onSubjectCompletionChange={vi.fn().mockResolvedValue(undefined)}
        onReorder={onReorder}
      />
    )

    const overdueRow = screen.getByDisplayValue('Overdue review').closest('[data-todo-id]')
    const todoContainer = screen.getByRole('list', { name: 'Thread Todos sortable list' })
    expect(todoContainer).toHaveClass('rounded-xl', 'divide-y')
    expect(overdueRow).not.toHaveClass('rounded-xl')
    expect(overdueRow).toHaveAttribute('data-overdue', 'true')
    expect(overdueRow).not.toHaveAttribute('draggable')
    expect(within(overdueRow as HTMLElement).getByLabelText('Drag Overdue review'))
      .not.toHaveAttribute('draggable')
    expect(within(overdueRow as HTMLElement).getByText('Overdue')).toBeVisible()
    expect(within(screen.getByLabelText('New Todo context')).getAllByRole('option')
      .map((option) => option.textContent)).toEqual(['Customer Operations', 'Platform Team'])

    await user.type(screen.getByLabelText('New Todo name'), 'Check rollout')
    fireEvent.change(screen.getByLabelText('New Todo due date'), {
      target: { value: '2026-08-20' }
    })
    await user.selectOptions(screen.getByLabelText('New Todo context'), 'customer')
    await user.click(screen.getByRole('button', { name: 'Add Todo' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      name: 'Check rollout',
      dueDate: '2026-08-20'
    }, 'customer'))

    await user.click(screen.getByLabelText('Mark Overdue review done'))
    expect(onUpdate).toHaveBeenCalledWith('1', { done: true })
    const dueDateInput = within(overdueRow as HTMLElement).getByLabelText('Todo due date')
    fireEvent.change(dueDateInput, {
      target: { value: '2026-08-22' }
    })
    expect(onUpdate).not.toHaveBeenCalledWith('1', { dueDate: '2026-08-22' })
    expect(dueDateInput).not.toBeDisabled()
    fireEvent.blur(dueDateInput)
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('1', { dueDate: '2026-08-22' })
    })
    const second = screen.getByDisplayValue('Prepare notes').closest('[data-todo-id]') as HTMLElement
    const handle = within(second).getByRole('button', { name: 'Drag Prepare notes' })
    handle.focus()
    await user.keyboard('[Space]')
    expect(screen.getByText('Drop Todo here')).toBeVisible()
    await user.keyboard('{ArrowUp}')
    await user.keyboard('[Space]')
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(['2', '1']))
    expect(screen.getByRole('list', { name: 'Thread Todos sortable list' })
      .querySelector('[data-todo-id] input[aria-label="Todo name"]')).toHaveValue('Prepare notes')

    await user.click(screen.getByRole('button', { name: 'Delete Prepare notes' }))
    expect(onDelete).toHaveBeenCalledWith('2')
  })

  it('keeps orphaned Todos in a closed editable and sortable accordion', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onReorder = vi.fn().mockResolvedValue(undefined)
    render(
      <TodoList
        ariaLabel="Thread Todos"
        items={[{
          id: '1',
          name: 'Current work',
          dueDate: null,
          done: false,
          overdue: false,
          contextLabel: 'Customer Operations'
        }]}
        orphanedItems={[
          {
            id: '2',
            name: 'Former platform work',
            dueDate: null,
            done: false,
            overdue: false,
            contextLabel: 'Platform Team · Orphaned'
          },
          {
            id: '3',
            name: 'Former aggregate work',
            dueDate: null,
            done: false,
            overdue: false,
            contextLabel: 'Orphaned'
          }
        ]}
        orphanedItemsLabel="Orphaned Todos"
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onSubjectCompletionChange={vi.fn().mockResolvedValue(undefined)}
        onReorder={onReorder}
      />
    )

    const toggle = screen.getByRole('button', { name: /Orphaned Todos/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Orphaned Todos' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Thread Todos sortable list' }))
      .queryByDisplayValue('Former platform work')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const orphanedList = screen.getByRole('list', { name: 'Orphaned Todos' })
    expect(within(orphanedList).getByText('Platform Team · Orphaned')).toBeVisible()

    const secondOrphan = within(orphanedList).getByDisplayValue('Former aggregate work')
      .closest('[data-todo-id]') as HTMLElement
    const handle = within(secondOrphan).getByRole('button', {
      name: 'Drag Former aggregate work'
    })
    handle.focus()
    await user.keyboard('[Space]')
    await user.keyboard('{ArrowUp}')
    await user.keyboard('[Space]')
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(['3', '2']))
  })

  it('expands shared Subject progress without making child rows draggable or deletable', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onSubjectCompletionChange = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <TodoList
        ariaLabel="Thread Todos"
        items={[{
          id: '9',
          name: 'Confirm rollout',
          dueDate: null,
          done: false,
          overdue: false,
          contextLabel: 'All subjects',
          canToggleDone: false,
          subjectCompletions: [
            { subjectId: '40', label: 'Customer Operations', done: false },
            { subjectId: '41', label: 'Platform Team', done: true }
          ]
        }]}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onSubjectCompletionChange={onSubjectCompletionChange}
        onReorder={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByLabelText('Confirm rollout completes when every Subject is done'))
      .toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Confirm rollout' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Subject progress/ }))
    const progress = screen.getByRole('list', { name: 'Confirm rollout Subject progress' })
    expect(within(progress).queryByRole('button', { name: /Drag/ })).not.toBeInTheDocument()
    expect(within(progress).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
    await user.click(within(progress).getByLabelText(
      'Mark Confirm rollout done for Customer Operations'
    ))
    expect(onSubjectCompletionChange).toHaveBeenCalledWith('9', '40', true)
    expect(onUpdate).not.toHaveBeenCalled()

    rerender(
      <TodoList
        ariaLabel="Thread Todos"
        items={[{
          id: '9',
          name: 'Confirm rollout',
          dueDate: null,
          done: false,
          overdue: false,
          contextLabel: 'Shared',
          canEdit: false,
          canDelete: false,
          completionSubjectId: '40'
        }]}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onSubjectCompletionChange={onSubjectCompletionChange}
        onReorder={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.queryByRole('button', { name: 'Delete Confirm rollout' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Todo name')).toBeDisabled()
    await user.click(screen.getByLabelText('Mark Confirm rollout done'))
    expect(onSubjectCompletionChange).toHaveBeenLastCalledWith('9', '40', true)
  })
})
