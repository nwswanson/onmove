import { describe, expect, it } from 'vitest'
import {
  assertOnMoveRichTextDocument,
  onMoveRichTextDocumentFromStored,
  onMoveRichTextDocumentToStored,
  type OnMoveRichTextDocument
} from '../../src/shared/rich-text-document'
import { richTextPlainText } from '../../src/shared/rich-text-value'

describe('OnMove rich-text API document', () => {
  const formatted: OnMoveRichTextDocument = {
    version: 1,
    blocks: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Important', marks: ['bold', 'highlight'], color: 'red' },
          { type: 'text', text: ' context with ' },
          {
            type: 'link',
            url: 'https://example.com/context',
            children: [{ type: 'text', text: 'evidence', marks: ['italic'] }]
          },
          { type: 'text', text: ' and ' },
          { type: 'text', text: '@Person1', tag: true, color: 'blue' }
        ]
      },
      {
        type: 'quote',
        blocks: [{
          type: 'checklist',
          items: [
            {
              content: [{ type: 'text', text: 'Verify the rollout' }],
              checked: true,
              children: [{
                type: 'bullet-list',
                items: [{ content: [{ type: 'text', text: 'Nested evidence' }] }]
              }]
            },
            { content: [{ type: 'text', text: 'Confirm support coverage' }], checked: false }
          ]
        }]
      },
      {
        type: 'numbered-list',
        start: 4,
        items: [{ content: [{ type: 'text', text: 'Preserve pasted numbering' }] }]
      }
    ]
  }

  it('round-trips every editor-supported semantic through Lexical storage', () => {
    const stored = onMoveRichTextDocumentToStored(formatted)

    expect(stored).toContain('onmove-rich-text:1:')
    expect(stored).toContain('"shadowRoot":true')
    expect(stored).toContain('"listType":"check"')
    expect(stored).toContain('"type":"link"')
    expect(stored).toContain('"type":"tag"')
    expect(onMoveRichTextDocumentFromStored(stored)).toEqual(formatted)
    expect(richTextPlainText(stored)).toContain('Important context with evidence and @Person1')
  })

  it('projects legacy plain text into editable paragraphs without losing blank lines', () => {
    expect(onMoveRichTextDocumentFromStored('First\n\nThird')).toEqual({
      version: 1,
      blocks: [
        { type: 'paragraph', children: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', children: [] },
        { type: 'paragraph', children: [{ type: 'text', text: 'Third' }] }
      ]
    })
    expect(onMoveRichTextDocumentToStored({ version: 1, blocks: [] })).toBe('')
  })

  it.each([
    [{ version: 2, blocks: [] }, 'version'],
    [{ version: 1, blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'x', marks: ['code'] }] }] }, 'marks'],
    [{ version: 1, blocks: [{ type: 'paragraph', children: [{ type: 'text', text: '@bad-tag', tag: true }] }] }, 'alphanumeric'],
    [{ version: 1, blocks: [{ type: 'paragraph', children: [{ type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'unsafe' }] }] }] }, 'http'],
    [{ version: 1, blocks: [{ type: 'bullet-list', items: [{ content: [], checked: true }] }] }, 'checklist']
  ])('rejects malformed or lossy input %#', (document, message) => {
    expect(() => assertOnMoveRichTextDocument(document)).toThrow(message)
  })

  it('canonicalizes mark ordering so equivalent requests serialize consistently', () => {
    expect(assertOnMoveRichTextDocument({
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [{ type: 'text', text: 'x', marks: ['highlight', 'bold'] }]
      }]
    })).toMatchObject({
      blocks: [{ children: [{ marks: ['bold', 'highlight'] }] }]
    })
  })
})
