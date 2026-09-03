// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UpdateList } from '../../src/renderer/src/features/updates/update-list'
import { validateUpdateListModel } from '../../src/renderer/src/features/updates/update-list-contract'
import { richTextPlainText } from '../../src/renderer/src/components/ui/rich-text-editor'

const states = [
  { value: 'red', label: 'Red', tone: 'danger' as const },
  { value: 'yellow', label: 'Yellow', tone: 'warning' as const },
  { value: 'green', label: 'Green', tone: 'success' as const },
  { value: 'none', label: 'None', tone: 'neutral' as const }
]

describe('UpdateList', () => {
  it('rejects duplicate items and unsupported states at its receiver boundary', () => {
    expect(() =>
      validateUpdateListModel(
        [
          { id: '1', date: '2026-08-07', observation: 'One', state: 'green', sensitive: false },
          { id: '1', date: '2026-08-08', observation: 'Two', state: 'green', sensitive: false }
        ],
        states
      )
    ).toThrow('invalid item "1"')
    expect(() =>
      validateUpdateListModel(
        [{ id: '1', date: '2026-08-07', observation: 'One', state: 'purple', sensitive: false }],
        states
      )
    ).toThrow('invalid item "1"')
  })

  it('owns inline editing, immediate creation, deletion, and visible state labels', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Ticket quality is uneven',
            state: 'yellow',
            sensitive: false
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    )

    const list = screen.getByRole('list', { name: 'Test updates' })
    expect(list).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Update from 2026-08-01' })).toBeInTheDocument()
    expect(screen.getByText('Yellow', { selector: 'span' })).toHaveClass(
      'text-warning-foreground'
    )
    const observation = screen.getByLabelText('Update observation')
    await user.type(observation, ' and acceptance criteria improved')
    await user.selectOptions(screen.getByLabelText('Update state'), 'green')
    expect(screen.getByText('Green', { selector: 'span' })).toHaveClass('text-success-foreground')
    expect(screen.queryByRole('button', { name: 'Save update' })).not.toBeInTheDocument()
    await waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 2_000 })
    const edited = onUpdate.mock.calls.at(-1)?.[1]
    expect(edited).toMatchObject({ date: '2026-08-01', state: 'green' })
    expect(richTextPlainText(edited.observation)).toBe(
      ' and acceptance criteria improvedTicket quality is uneven'
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce())
    expect(onCreate).toHaveBeenCalledWith({
      date: '2026-08-07',
      observation: '',
      state: 'none',
      sensitive: false
    })
    expect(screen.queryByRole('button', { name: 'Create update' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel new update' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete update' }))
    expect(onDelete).toHaveBeenCalledWith('20')
  })

  it('reveals a row created by an external composer', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    const item = {
      id: '20',
      date: '2026-08-01',
      observation: 'Created globally',
      state: 'green',
      sensitive: false
    }
    const rendered = render(
      <UpdateList
        ariaLabel="External updates"
        items={[item]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        revealItemId={null}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    rendered.rerender(
      <UpdateList
        ariaLabel="External updates"
        items={[item]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        revealItemId="20"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const card = screen.getByRole('listitem', { name: 'Update from 2026-08-01' })
    await waitFor(() => expect(scrollIntoView.mock.instances).toContain(card))
  })

  it('applies an externally committed observation with its matching revision', async () => {
    const item = {
      id: '20',
      date: '2026-08-01',
      observation: 'a',
      state: 'green',
      sensitive: false,
      externalRevision: 1
    }
    const props = {
      ariaLabel: 'Externally synchronized updates',
      stateOptions: states,
      defaultDate: '2026-08-07',
      defaultState: 'none',
      onUpdate: vi.fn(),
      onObservationChange: vi.fn(),
      onDelete: vi.fn()
    } as const
    const rendered = render(<UpdateList {...props} items={[item]} />)
    const observation = screen.getByLabelText('Update observation')

    expect(observation).toHaveTextContent('a')
    rendered.rerender(<UpdateList
      {...props}
      items={[{ ...item, observation: 'ab', externalRevision: 2 }]}
    />)
    await waitFor(() => expect(observation).toHaveTextContent('ab'))
    rendered.rerender(<UpdateList
      {...props}
      items={[{ ...item, observation: 'abc', externalRevision: 3 }]}
    />)
    await waitFor(() => expect(observation).toHaveTextContent('abc'))
  })

  it('owns choice-based immediate creation without exposing a second create step', async () => {
    const onCreateFor = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Scoped updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-08"
        defaultState="none"
        createOptions={[
          { id: '40', label: 'Customer Operations' },
          { id: '41', label: 'Platform Team' }
        ]}
        createOptionsLabel="Add update for Subject…"
        onCreateFor={onCreateFor}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Add update' })).not.toBeInTheDocument()
    const subjectChoice = screen.getByRole('combobox', { name: 'Add update for Subject…' })
    await user.selectOptions(subjectChoice, '41')
    await waitFor(() => expect(onCreateFor).toHaveBeenCalledOnce())
    expect(onCreateFor).toHaveBeenCalledWith('41', {
      date: '2026-08-08',
      observation: '',
      state: 'none',
      sensitive: false
    })
    expect(subjectChoice).toHaveValue('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves Cmd-P to the workspace-level update composer', () => {
    const onCreate = vi.fn().mockResolvedValue('42')
    render(
      <UpdateList
        ariaLabel="Shortcut updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-11"
        defaultState="none"
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const controlEvent = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    document.dispatchEvent(controlEvent)
    expect(controlEvent.defaultPrevented).toBe(false)
    expect(onCreate).not.toHaveBeenCalled()

    const metaEvent = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true
    })
    document.dispatchEvent(metaEvent)

    expect(metaEvent.defaultPrevented).toBe(false)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('does not couple the native Subject picker to the global Cmd-P command', () => {
    const onCreateFor = vi.fn().mockResolvedValue(undefined)
    render(
      <UpdateList
        ariaLabel="Scoped shortcut updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-11"
        defaultState="none"
        createOptions={[{ id: '41', label: 'Platform Team' }]}
        createOptionsLabel="Add update for Subject…"
        onCreateFor={onCreateFor}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    fireEvent.keyDown(document, { key: 'p', metaKey: true })

    expect(screen.getByRole('combobox', { name: 'Add update for Subject…' })).not.toHaveFocus()
    expect(onCreateFor).not.toHaveBeenCalled()
  })

  it('keeps former-scope cards in a closed-by-default editable accordion', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Current scoped updates"
        items={[{
          id: '20',
          date: '2026-08-08',
          observation: 'Current evidence',
          state: 'green',
          sensitive: false
        }]}
        formerItems={[{
          id: '19',
          date: '2026-08-01',
          observation: 'Former evidence',
          state: 'yellow',
          sensitive: false,
          contextLabel: 'Customer Operations · Former scope'
        }]}
        formerItemsLabel="Former scope updates"
        stateOptions={states}
        defaultDate="2026-08-08"
        defaultState="none"
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    )

    expect(
      within(screen.getByRole('list', { name: 'Current scoped updates' }))
        .getByText('Current evidence')
    ).toBeVisible()
    const accordion = screen.getByRole('button', { name: /Former scope updates/ })
    expect(accordion).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Former scope updates' }))
      .not.toBeInTheDocument()

    await user.click(accordion)
    expect(accordion).toHaveAttribute('aria-expanded', 'true')
    const formerList = screen.getByRole('list', { name: 'Former scope updates' })
    expect(within(formerList).getByText('Former evidence')).toBeVisible()
    expect(within(formerList).getByText('Customer Operations · Former scope')).toBeVisible()
    await user.click(within(formerList).getByRole('button', { name: 'Delete update' }))
    expect(onDelete).toHaveBeenCalledWith('19')
  })

  it('shows receiver-owned loading, empty, and failure states', () => {
    const { rerender } = render(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        loading
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Loading updates…')).toBeInTheDocument()
    rerender(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        loadError="Updates could not be loaded."
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByText('No updates yet.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Updates could not be loaded.')
  })

  it('renders a complete sensitive Update model and autosaves its sensitivity flag', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Sensitive updates"
        items={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Confidential acquisition detail',
            state: 'red',
            sensitive: true
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Confidential acquisition detail')).toBeVisible()
    expect(screen.getByLabelText('Update observation')).toBeInTheDocument()
    expect(screen.getByLabelText('Update date')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('Update state')).toHaveValue('red')

    await user.click(screen.getByRole('checkbox', { name: 'Sensitive' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 2_000 })
    expect(onUpdate).toHaveBeenCalledWith(
      '20',
      expect.objectContaining({ sensitive: false })
    )
    expect(richTextPlainText(onUpdate.mock.calls[0][1].observation)).toBe(
      'Confidential acquisition detail'
    )
  })

  it('renders a long history as independent full-width editor cards', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      observation: `Narrative update ${index + 1}`,
      state: index % 2 === 0 ? 'green' : 'none',
      sensitive: false
    }))
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={items}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const list = screen.getByRole('list', { name: 'Test updates' })
    expect(list).toHaveClass('space-y-3')
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    expect(screen.getAllByLabelText('Update observation')).toHaveLength(12)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('autosaves an existing observation after the shared throttle interval', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Initial signal',
            state: 'yellow',
            sensitive: false
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('Update observation'), ' improved')
    expect(onUpdate).not.toHaveBeenCalled()
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 2_000 })
    expect(richTextPlainText(onUpdate.mock.calls[0][1].observation)).toContain('improved')
  })

  it('autosaves existing date and state fields without a save action', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[
          {
            id: '20',
            date: '2026-08-01',
            observation: 'Initial signal',
            state: 'yellow',
            sensitive: false
          }
        ]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    )

    await user.clear(screen.getByLabelText('Update date'))
    await user.type(screen.getByLabelText('Update date'), '2026-08-06')
    await user.selectOptions(screen.getByLabelText('Update state'), 'green')

    expect(screen.queryByRole('button', { name: 'Save update' })).not.toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce(), { timeout: 2_000 })
    const savedDraft = onUpdate.mock.calls[0][1]
    expect(savedDraft).toMatchObject({ date: '2026-08-06', state: 'green' })
    expect(richTextPlainText(savedDraft.observation)).toBe('Initial signal')
  })

  it('immediately persists a blank update when Add update is pressed', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      date: '2026-08-07',
      observation: '',
      state: 'none',
      sensitive: false
    }))
    expect(screen.queryByLabelText('New update date')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create update' })).not.toBeInTheDocument()
  })

  it('prevents duplicate adds while persistence is pending and exposes creation failures', async () => {
    let rejectCreate: ((reason?: unknown) => void) | undefined
    const onCreate = vi.fn(
      () => new Promise<void>((_resolve, reject) => {
        rejectCreate = reject
      })
    )
    const user = userEvent.setup()
    render(
      <UpdateList
        ariaLabel="Test updates"
        items={[]}
        stateOptions={states}
        defaultDate="2026-08-07"
        defaultState="none"
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add update' }))
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()
    expect(onCreate).toHaveBeenCalledOnce()
    rejectCreate?.(new Error('database unavailable'))

    expect(await screen.findByRole('alert')).toHaveTextContent('The update could not be added.')
    expect(screen.getByRole('button', { name: 'Add update' })).toBeEnabled()
  })
})
