// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { createRef, useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  isRichText,
  RichTextContent,
  RichTextEditor,
  type RichTextEditorHandle,
  richTextPlainText
} from '../../src/renderer/src/components/ui/rich-text-editor'

function selectText(editor: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text)
  }

  let offset = 0
  let startPoint: { node: Text; offset: number } | null = null
  let endPoint: { node: Text; offset: number } | null = null
  for (const node of textNodes) {
    const nextOffset = offset + node.data.length
    if (!startPoint && start >= offset && start <= nextOffset) {
      startPoint = { node, offset: start - offset }
    }
    if (!endPoint && end >= offset && end <= nextOffset) {
      endPoint = { node, offset: end - offset }
    }
    offset = nextOffset
  }
  if (!startPoint || !endPoint) throw new Error('Text selection is outside the editor content')

  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

describe('RichTextEditor', () => {
  it('exposes the latest committed value for confirmation-based forms', async () => {
    const editorRef = createRef<RichTextEditorHandle>()
    const user = userEvent.setup()
    render(
      <RichTextEditor
        ref={editorRef}
        value=""
        ariaLabel="Draft"
        onChange={vi.fn()}
      />
    )

    const editor = screen.getByRole('textbox', { name: 'Draft' })
    await user.click(editor)
    await user.paste('Latest draft')

    await waitFor(() => expect(richTextPlainText(editorRef.current?.getValue() ?? ''))
      .toBe('Latest draft'))
  })

  it('materializes alphanumeric @tags as durable visual nodes', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const rendered = render(
      <RichTextEditor value="Plan" ariaLabel="Notes" onChange={onChange} />
    )
    const editor = screen.getByRole('textbox', { name: 'Notes' })

    await user.click(editor)
    await user.type(editor, ' with @Release2, not @release-plan')

    await waitFor(() => {
      const tags = [...editor.querySelectorAll('[data-text-tag]')]
      expect(tags.map((tag) => tag.textContent)).toEqual(['@Release2'])
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('"type":"tag"')
    })
    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(richTextPlainText(value)).toBe('Plan with @Release2, not @release-plan')

    rendered.unmount()
    render(<RichTextContent value={value} ariaLabel="Rendered tags" />)
    expect(screen.getByLabelText('Rendered tags')).toHaveTextContent(
      'Plan with @Release2, not @release-plan'
    )
    expect(screen.getByText('@Release2')).toHaveAttribute('data-text-tag')
    expect(document.querySelectorAll('[data-text-tag]')).toHaveLength(1)
  })

  it('removes tag-node semantics when a token gains a disallowed continuation', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RichTextEditor value="@Release2" ariaLabel="Notes" onChange={onChange} />)
    const editor = screen.getByRole('textbox', { name: 'Notes' })

    await waitFor(() => expect(editor.querySelector('[data-text-tag]')).not.toBeNull())
    await user.click(editor)
    selectText(editor, 9, 9)
    await user.type(editor, '-plan')

    await waitFor(() => expect(editor.querySelector('[data-text-tag]')).toBeNull())
    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(richTextPlainText(value)).toBe('@Release2-plan')
    expect(value).not.toContain('"type":"tag"')
  })

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

  it('supports formatting, lists, and a readable editor color palette', async () => {
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
    const colorSelect = screen.getByRole('combobox', { name: 'Text color' })
    expect(colorSelect).toHaveTextContent('Gray')
    expect(colorSelect).toHaveTextContent('Red')
    expect(colorSelect).toHaveTextContent('Orange')
    expect(colorSelect).toHaveTextContent('Yellow')
    expect(colorSelect).toHaveTextContent('Green')
    expect(colorSelect).toHaveTextContent('Blue')
    expect(colorSelect).toHaveTextContent('Purple')
    await user.selectOptions(colorSelect, 'var(--rich-text-red)')
    await waitFor(() => {
      const value = onChange.mock.calls.at(-1)?.[0] as string
      expect(value).toContain('color: var(--rich-text-red)')
    })
  })

  it('applies one color to every text node in a mixed selection while preserving formats', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RichTextEditor value="Red Green" ariaLabel="Notes" onChange={onChange} />)

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    const colorSelect = screen.getByRole('combobox', { name: 'Text color' })
    await user.click(editor)
    selectText(editor, 0, 3)
    await user.click(screen.getByRole('button', { name: 'Bold' }))
    selectText(editor, 0, 3)
    await user.selectOptions(colorSelect, 'var(--rich-text-red)')
    await waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('var(--rich-text-red)')
    })

    selectText(editor, 4, 9)
    await user.selectOptions(colorSelect, 'var(--rich-text-green)')
    await waitFor(() => {
      const value = onChange.mock.calls.at(-1)?.[0] as string
      expect(value).toContain('var(--rich-text-red)')
      expect(value).toContain('var(--rich-text-green)')
    })

    selectText(editor, 0, 9)
    await waitFor(() => expect(colorSelect).toHaveValue('mixed'))
    await user.selectOptions(colorSelect, 'var(--rich-text-blue)')
    await waitFor(() => {
      const value = onChange.mock.calls.at(-1)?.[0] as string
      expect(value).toContain('var(--rich-text-blue)')
      expect(value).not.toContain('var(--rich-text-red)')
      expect(value).not.toContain('var(--rich-text-green)')
    })
    expect(editor.querySelector('strong')).toHaveTextContent('Red')
  })

  it('supports persistent strikethrough and highlight keyboard shortcuts with discoverable tooltips', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <RichTextEditor value="Finished work" ariaLabel="Notes" onChange={onChange} />
    )

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    const strikethroughButton = screen.getByRole('button', { name: 'Strikethrough' })
    const highlightButton = screen.getByRole('button', { name: 'Highlight' })
    expect(strikethroughButton).toHaveAttribute('title', 'Strikethrough (⌘⇧X)')
    expect(strikethroughButton).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+X')
    expect(highlightButton).toHaveAttribute('title', 'Highlight (⌘Y)')
    expect(highlightButton).toHaveAttribute('aria-keyshortcuts', 'Meta+Y')

    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('{Meta>}{Shift>}x{/Shift}{/Meta}')
    expect(strikethroughButton).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Meta>}y{/Meta}')
    expect(highlightButton).toHaveAttribute('aria-pressed', 'true')
    expect(editor.querySelector('.line-through')).toHaveTextContent('Finished work')
    expect(editor.querySelector('.onmove-rich-text-highlight')).toHaveTextContent('Finished work')

    let serialized = ''
    await waitFor(() => {
      serialized = onChange.mock.calls.at(-1)?.[0] as string
      expect(serialized).toContain('Finished work')
    })
    rerender(<RichTextContent value={serialized} ariaLabel="Rendered content" />)
    expect(
      screen.getByLabelText('Rendered content').querySelector('.line-through')
    ).toHaveTextContent('Finished work')
    expect(
      screen.getByLabelText('Rendered content').querySelector('.onmove-rich-text-highlight')
    ).toHaveTextContent('Finished work')
  })

  it.each([
    ['bulleted', 'Bulleted list', 'ul'],
    ['numbered', 'Numbered list', 'ol'],
    ['check', 'Checklist', 'ul']
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

  it('inserts safe links and keeps them clickable in read-only content', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <RichTextEditor value="Open the handbook" ariaLabel="Notes" onChange={onChange} />
    )

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Insert link' }))
    await user.type(screen.getByRole('textbox', { name: 'Link URL' }), 'handbook.example.com')
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    const editableLink = editor.querySelector('a')
    expect(editableLink).toHaveAttribute('href', 'https://handbook.example.com/')
    expect(editableLink).toHaveAttribute('target', '_blank')
    expect(editableLink).toHaveAttribute('rel', 'noopener noreferrer')

    let serialized = ''
    await waitFor(() => {
      serialized = onChange.mock.calls.at(-1)?.[0] as string
      expect(serialized).toContain('https://handbook.example.com/')
    })

    rerender(<RichTextContent value={serialized} ariaLabel="Rendered content" />)
    const renderedLink = screen.getByRole('link', { name: 'Open the handbook' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await user.click(renderedLink)
    expect(open).toHaveBeenCalledWith('https://handbook.example.com/', '_blank')
    open.mockRestore()
  })

  it('turns a pasted URL into a durable link without linking ordinary clipboard text', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const rendered = render(
      <RichTextEditor value="Reference: " ariaLabel="Notes" onChange={onChange} />
    )

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    await user.click(editor)
    await user.paste('https://docs.example.com/guide?section=review#today')

    const pastedLink = await waitFor(() => {
      const link = editor.querySelector('a')
      expect(link).toHaveAttribute(
        'href',
        'https://docs.example.com/guide?section=review#today'
      )
      return link
    })
    expect(pastedLink).toHaveTextContent('https://docs.example.com/guide?section=review#today')
    expect(pastedLink).toHaveAttribute('target', '_blank')
    expect(pastedLink).toHaveAttribute('rel', 'noopener noreferrer')

    let serialized = ''
    await waitFor(() => {
      serialized = onChange.mock.calls.at(-1)?.[0] as string
      expect(serialized).toContain('https://docs.example.com/guide?section=review#today')
      expect(serialized).toContain('"type":"link"')
    })

    rendered.unmount()
    const readOnly = render(<RichTextContent value={serialized} ariaLabel="Rendered paste" />)
    expect(screen.getByRole('link', {
      name: 'https://docs.example.com/guide?section=review#today'
    })).toHaveAttribute('href', 'https://docs.example.com/guide?section=review#today')

    readOnly.unmount()
    render(<RichTextEditor value="" ariaLabel="Plain notes" onChange={vi.fn()} />)
    const plainEditor = screen.getByRole('textbox', { name: 'Plain notes' })
    await user.click(plainEditor)
    await user.paste('ordinary clipboard text')
    expect(plainEditor).toHaveTextContent('ordinary clipboard text')
    expect(plainEditor.querySelector('a')).toBeNull()
  })

  it('pastes unsafe URL schemes as plain text instead of executable links', async () => {
    const user = userEvent.setup()
    render(<RichTextEditor value="" ariaLabel="Notes" onChange={vi.fn()} />)

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    await user.click(editor)
    await user.paste('javascript:alert(1)')

    expect(editor).toHaveTextContent('javascript:alert(1)')
    expect(editor.querySelector('a')).toBeNull()
  })

  it('rejects links that could execute or open local content', async () => {
    const user = userEvent.setup()
    render(<RichTextEditor value="Unsafe" ariaLabel="Notes" onChange={vi.fn()} />)

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Insert link' }))
    await user.type(screen.getByRole('textbox', { name: 'Link URL' }), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter an http, https, or email link.')
    expect(editor.querySelector('a')).toBeNull()
  })

  it('creates persistent, interactive checklist items', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <RichTextEditor value="Ship the release" ariaLabel="Notes" onChange={onChange} />
    )

    const editor = screen.getByRole('textbox', { name: 'Notes' })
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Checklist' }))
    const checklistItem = editor.querySelector('[role="checkbox"]') as HTMLElement
    expect(checklistItem).toHaveAttribute('aria-checked', 'false')

    checklistItem.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(checklistItem).toHaveAttribute('aria-checked', 'true'))

    let serialized = ''
    await waitFor(() => {
      serialized = onChange.mock.calls.at(-1)?.[0] as string
      expect(serialized).toContain('"listType":"check"')
      expect(serialized).toContain('"checked":true')
    })

    rerender(<RichTextContent value={serialized} ariaLabel="Rendered checklist" />)
    expect(screen.getByLabelText('Rendered checklist')).toHaveTextContent('Ship the release')
    expect(screen.getByLabelText('Rendered checklist').querySelector('[role="checkbox"]')).toHaveAttribute(
      'aria-checked',
      'true'
    )
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

  it('preserves rapid local typing and paints the complete newest external revision', async () => {
    const user = userEvent.setup()

    function Harness(): React.JSX.Element {
      const [value, setValue] = useState('Local')
      const [revision, setRevision] = useState(1)
      return (
        <>
          <RichTextEditor
            value={value}
            externalRevision={revision}
            ariaLabel="Synced notes"
            onChange={setValue}
          />
          <button
            type="button"
            onClick={() => {
              setValue('asd')
              setRevision(2)
            }}
          >
            Receive first remote revision
          </button>
          <button
            type="button"
            onClick={() => {
              setValue('asdf')
              setRevision(3)
            }}
          >
            Receive final remote revision
          </button>
        </>
      )
    }

    render(<Harness />)
    const editor = screen.getByRole('textbox', { name: 'Synced notes' })
    await user.type(editor, ' typing quickly')
    expect(editor.textContent).toContain('typing quicklyLocal')

    await user.click(screen.getByRole('button', { name: 'Receive first remote revision' }))
    expect(editor).toHaveTextContent('asd')
    await user.click(screen.getByRole('button', { name: 'Receive final remote revision' }))
    expect(editor).toHaveTextContent('asdf')
    expect(editor).not.toHaveTextContent('typing quickly')
  })
})
