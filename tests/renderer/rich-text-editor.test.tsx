// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  isRichText,
  RichTextContent,
  RichTextEditor,
  richTextPlainText
} from '../../src/renderer/src/components/ui/rich-text-editor'

describe('RichTextEditor', () => {
  it('imports legacy plain text and emits a reusable serialized document', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <RichTextEditor
        value="Legacy notes"
        ariaLabel="Notes"
        onChange={onChange}
      />
    )

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    expect(editor).toHaveTextContent('Legacy notes')
    await user.click(editor)
    await user.type(editor, ' become structured')
    expect(editor).toHaveTextContent('Legacy notes become structured')

    await waitFor(() => {
      const value = onChange.mock.calls.at(-1)?.[0] as string
      expect(isRichText(value)).toBe(true)
      expect(richTextPlainText(value)).toBe('Legacy notes become structured')
    })
  })

  it('supports formatting, lists, and the app color palette', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RichTextEditor value="Format me" ariaLabel="Notes" onChange={onChange} />)

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Bulleted list' }))
    expect(editor.querySelector('ul')).not.toBeNull()

    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text color' }), '#e2583e')
    await waitFor(() => {
      const value = onChange.mock.calls.at(-1)?.[0] as string
      expect(value).toContain('color: #e2583e')
    })
  })

  it.each([
    ['bulleted', 'Bulleted list', 'ul'],
    ['numbered', 'Numbered list', 'ol']
  ])('uses Tab and Shift+Tab to nest and outdent %s list items', async (_, buttonName, tag) => {
    const user = userEvent.setup()
    render(<RichTextEditor value="Parent" ariaLabel="Notes" onChange={vi.fn()} />)

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: buttonName }))
    await user.click(editor)
    await user.keyboard('{Enter}Child')
    expect(editor.querySelectorAll('li')).toHaveLength(2)

    await user.keyboard('{Tab}')
    expect(editor).toHaveFocus()
    const nestedList = editor.querySelector(`${tag} ${tag}`)
    expect(nestedList).not.toBeNull()
    expect(nestedList?.parentElement).toHaveClass('list-none')

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(editor.querySelector(`${tag} ${tag}`)).toBeNull()
    expect(editor.querySelectorAll('li')).toHaveLength(2)
  })

  it('leaves Tab available for normal keyboard navigation outside a list', async () => {
    const user = userEvent.setup()
    render(
      <>
        <RichTextEditor value="Paragraph" ariaLabel="Notes" onChange={vi.fn()} />
        <button type="button">After editor</button>
      </>
    )

    await user.click(screen.getByRole('textbox', { name: 'Notes' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'After editor' })).toHaveFocus()
  })

  it('renders serialized and legacy values read-only', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <RichTextEditor value="Rendered text" ariaLabel="Editor" onChange={onChange} />
    )
    const editor = screen.getByRole('textbox', { name: 'Editor' })
    await user.click(editor)
    await user.type(editor, '!')
    const serialized = onChange.mock.calls.at(-1)?.[0] as string

    rerender(<RichTextContent value={serialized} ariaLabel="Rendered content" />)
    expect(screen.getByLabelText('Rendered content')).toHaveTextContent('Rendered text!')
  })
})
