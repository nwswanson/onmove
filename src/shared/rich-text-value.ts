export const RICH_TEXT_PREFIX = 'onmove-rich-text:1:'

/** Returns the serialized Lexical state only when the versioned envelope is valid. */
export function serializedRichTextEditorState(value: string): string | null {
  if (!value.startsWith(RICH_TEXT_PREFIX)) return null
  const serialized = value.slice(RICH_TEXT_PREFIX.length)
  try {
    const parsed = JSON.parse(serialized) as { root?: unknown }
    return parsed && typeof parsed === 'object' && parsed.root ? serialized : null
  } catch {
    return null
  }
}

/**
 * Domain-safe plain-text projection used by search and indexing. Legacy values
 * pass through unchanged; Lexical structure and formatting never cross into a
 * snippet or search token.
 */
export function richTextPlainText(value: string): string {
  const serialized = serializedRichTextEditorState(value)
  if (!serialized) return value

  const document = JSON.parse(serialized) as {
    root: { children?: unknown[] }
  }
  function read(node: unknown): string {
    if (!node || typeof node !== 'object') return ''
    const record = node as { children?: unknown[]; text?: unknown; type?: unknown }
    if (typeof record.text === 'string') return record.text
    const content = (record.children ?? []).map(read).join('')
    return record.type === 'paragraph' || record.type === 'listitem' ? `${content}\n` : content
  }
  return read(document.root).replace(/\n+$/, '')
}
