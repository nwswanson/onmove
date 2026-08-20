import { describe, expect, it } from 'vitest'
import {
  OnMoveRichTextPatchError,
  assertOnMoveRichTextDocument,
  onMoveRichTextDocumentFromStored,
  onMoveRichTextDocumentToStored,
  patchOnMoveRichTextDocument,
  type OnMoveRichTextDocument
} from '../../src/shared/rich-text-document'
import { richTextPlainText } from '../../src/shared/rich-text-value'

function richText(text: string): OnMoveRichTextDocument {
  return {
    version: 1,
    blocks: [{ type: 'paragraph', children: [{ type: 'text', text }] }]
  }
}

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

  it('accepts the intuitive yellow-highlight alias and returns its canonical mark', () => {
    expect(assertOnMoveRichTextDocument({
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [{ type: 'text', text: 'x', marks: ['italic', 'highlight-yellow'] }]
      }]
    })).toMatchObject({
      blocks: [{ children: [{ marks: ['italic', 'highlight'] }] }]
    })
  })

  it('patches one text range while preserving surrounding formatting and color', () => {
    const document: OnMoveRichTextDocument = {
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [{
          type: 'text',
          text: 'Before hello world after',
          marks: ['bold'],
          color: 'blue'
        }]
      }]
    }

    expect(patchOnMoveRichTextDocument(document, {
      findText: 'hello world',
      replaceText: 'hi there',
      addMarks: ['italic'],
      removeMarks: ['bold']
    })).toEqual({
      matchCount: 1,
      appliedOccurrence: 1,
      document: {
        version: 1,
        blocks: [{
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Before ', marks: ['bold'], color: 'blue' },
            { type: 'text', text: 'hi there', marks: ['italic'], color: 'blue' },
            { type: 'text', text: ' after', marks: ['bold'], color: 'blue' }
          ]
        }]
      }
    })
  })

  it('applies formatting across adjacent runs without collapsing their structure', () => {
    const result = patchOnMoveRichTextDocument({
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [
          { type: 'text', text: 'hello ', marks: ['bold'] },
          { type: 'text', text: 'world', color: 'green' }
        ]
      }]
    }, {
      findText: 'hello world',
      addMarks: ['underline']
    })

    expect(result.document).toEqual({
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [
          { type: 'text', text: 'hello ', marks: ['bold', 'underline'] },
          { type: 'text', text: 'world', marks: ['underline'], color: 'green' }
        ]
      }]
    })
  })

  it('requires an occurrence for duplicate exact matches and rejects block-spanning patches', () => {
    const duplicate = richText('hello world hello world')
    expect(() => patchOnMoveRichTextDocument(duplicate, {
      findText: 'hello world',
      replaceText: 'hi there'
    })).toThrow(OnMoveRichTextPatchError)
    try {
      patchOnMoveRichTextDocument(duplicate, {
        findText: 'hello world',
        replaceText: 'hi there'
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOTE_TEXT_AMBIGUOUS', matchCount: 2 })
    }
    expect(patchOnMoveRichTextDocument(duplicate, {
      findText: 'hello world',
      replaceText: 'hi there',
      occurrence: 2
    }).document).toEqual(richText('hello world hi there'))
    expect(() => patchOnMoveRichTextDocument(duplicate, {
      findText: 'world\nhello',
      replaceText: 'no'
    })).toThrow('cannot cross a structural line')
  })
})
