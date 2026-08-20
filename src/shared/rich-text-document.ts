import { RICH_TEXT_PREFIX, serializedRichTextEditorState } from './rich-text-value'

export const ONMOVE_RICH_TEXT_DOCUMENT_VERSION = 1 as const

export const ONMOVE_RICH_TEXT_MARKS = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'highlight'
] as const

/** Accepted write aliases; reads always return the canonical marks above. */
export const ONMOVE_RICH_TEXT_INPUT_MARKS = [
  ...ONMOVE_RICH_TEXT_MARKS,
  'highlight-yellow'
] as const

export const ONMOVE_RICH_TEXT_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple'
] as const

export type OnMoveRichTextMark = (typeof ONMOVE_RICH_TEXT_MARKS)[number]
export type OnMoveRichTextColor = (typeof ONMOVE_RICH_TEXT_COLORS)[number]

export interface OnMoveRichTextText {
  type: 'text'
  text: string
  marks?: OnMoveRichTextMark[]
  color?: OnMoveRichTextColor
  /** Preserves the editor's durable visual @tag token. */
  tag?: true
}

export interface OnMoveRichTextLink {
  type: 'link'
  url: string
  children: OnMoveRichTextText[]
}

export interface OnMoveRichTextLineBreak {
  type: 'line-break'
}

export type OnMoveRichTextInline =
  | OnMoveRichTextText
  | OnMoveRichTextLink
  | OnMoveRichTextLineBreak

export interface OnMoveRichTextParagraph {
  type: 'paragraph'
  children: OnMoveRichTextInline[]
}

export interface OnMoveRichTextListItem {
  content: OnMoveRichTextInline[]
  checked?: boolean
  children?: OnMoveRichTextList[]
}

export interface OnMoveRichTextList {
  type: 'bullet-list' | 'numbered-list' | 'checklist'
  items: OnMoveRichTextListItem[]
  /** Preserves a pasted ordered list that starts at a value other than one. */
  start?: number
}

export interface OnMoveRichTextQuote {
  type: 'quote'
  blocks: OnMoveRichTextBlock[]
}

export type OnMoveRichTextBlock =
  | OnMoveRichTextParagraph
  | OnMoveRichTextList
  | OnMoveRichTextQuote

/** Stable, editor-neutral rich-text contract exposed by the MCP API. */
export interface OnMoveRichTextDocument {
  version: typeof ONMOVE_RICH_TEXT_DOCUMENT_VERSION
  blocks: OnMoveRichTextBlock[]
}

const FORMAT_BITS: Readonly<Record<OnMoveRichTextMark, number>> = {
  bold: 1,
  italic: 1 << 1,
  strikethrough: 1 << 2,
  underline: 1 << 3,
  highlight: 1 << 7
}
const SUPPORTED_FORMAT_BITS = Object.values(FORMAT_BITS).reduce((value, bit) => value | bit, 0)
const INPUT_MARKS = new Set<string>(ONMOVE_RICH_TEXT_INPUT_MARKS)
const COLORS = new Set<string>(ONMOVE_RICH_TEXT_COLORS)
const TAG_PATTERN = /^@[A-Za-z0-9]+$/u
const MAX_DEPTH = 16
const MAX_NODES = 10_000
const MAX_TEXT_LENGTH = 1_000_000

interface ValidationBudget {
  nodes: number
  textLength: number
}

type LexicalRecord = Record<string, unknown>

function record(value: unknown, label: string): LexicalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as LexicalRecord
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function countNode(budget: ValidationBudget, depth: number): void {
  budget.nodes += 1
  if (depth > MAX_DEPTH) throw new Error(`rich text exceeds the maximum depth of ${MAX_DEPTH}`)
  if (budget.nodes > MAX_NODES) throw new Error(`rich text exceeds ${MAX_NODES} nodes`)
}

function countText(budget: ValidationBudget, text: string): void {
  budget.textLength += text.length
  if (budget.textLength > MAX_TEXT_LENGTH) {
    throw new Error(`rich text exceeds ${MAX_TEXT_LENGTH} characters`)
  }
}

function assertAllowedKeys(value: LexicalRecord, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) throw new Error(`${label} contains unsupported field ${unknown[0]}`)
}

function validLinkUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function marksFromFormat(value: unknown): OnMoveRichTextMark[] | undefined {
  const format = typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
  if ((format & ~SUPPORTED_FORMAT_BITS) !== 0) {
    throw new Error('stored rich text uses an unsupported text format')
  }
  const marks = ONMOVE_RICH_TEXT_MARKS.filter((mark) => (format & FORMAT_BITS[mark]) !== 0)
  return marks.length > 0 ? marks : undefined
}

function colorFromStyle(value: unknown): OnMoveRichTextColor | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('stored rich-text style must be text')
  const match = /^\s*color:\s*var\(--rich-text-(gray|red|orange|yellow|green|blue|purple)\)\s*;?\s*$/u.exec(value)
  if (!match) throw new Error('stored rich text uses an unsupported text style')
  return match[1] as OnMoveRichTextColor
}

function lexicalText(node: LexicalRecord): OnMoveRichTextText {
  if (typeof node.text !== 'string') throw new Error('stored rich-text text node has no text')
  const result: OnMoveRichTextText = { type: 'text', text: node.text }
  const marks = marksFromFormat(node.format)
  const color = colorFromStyle(node.style)
  if (marks) result.marks = marks
  if (color) result.color = color
  if (node.type === 'tag') result.tag = true
  return result
}

function lexicalInline(nodeValue: unknown): OnMoveRichTextInline {
  const node = record(nodeValue, 'stored rich-text inline node')
  if (node.type === 'text' || node.type === 'tag') return lexicalText(node)
  if (node.type === 'linebreak') return { type: 'line-break' }
  if (node.type === 'link') {
    if (typeof node.url !== 'string' || !validLinkUrl(node.url)) {
      throw new Error('stored rich text contains an unsupported link URL')
    }
    return {
      type: 'link',
      url: node.url,
      children: array(node.children, 'stored rich-text link children').map((child) => {
        const text = record(child, 'stored rich-text link child')
        if (text.type !== 'text' && text.type !== 'tag') {
          throw new Error('stored rich-text links may contain only text')
        }
        return lexicalText(text)
      })
    }
  }
  throw new Error(`stored rich text contains unsupported inline node ${String(node.type)}`)
}

function lexicalList(node: LexicalRecord): OnMoveRichTextList {
  const listType = node.listType === 'number'
    ? 'numbered-list'
    : node.listType === 'check'
      ? 'checklist'
      : node.listType === 'bullet'
        ? 'bullet-list'
        : null
  if (!listType) throw new Error(`stored rich text contains unsupported list type ${String(node.listType)}`)
  const items = array(node.children, 'stored rich-text list children').map((itemValue) => {
    const item = record(itemValue, 'stored rich-text list item')
    if (item.type !== 'listitem') throw new Error('stored rich-text list contains a non-item child')
    const content: OnMoveRichTextInline[] = []
    const children: OnMoveRichTextList[] = []
    for (const childValue of array(item.children, 'stored rich-text list item children')) {
      const child = record(childValue, 'stored rich-text list item child')
      if (child.type === 'list') children.push(lexicalList(child))
      else content.push(lexicalInline(child))
    }
    const result: OnMoveRichTextListItem = { content }
    if (listType === 'checklist') result.checked = Boolean(item.checked)
    if (children.length > 0) result.children = children
    return result
  })
  if (listType === 'numbered-list') {
    const start = Number.isSafeInteger(node.start) && Number(node.start) > 0 ? Number(node.start) : 1
    return start === 1 ? { type: listType, items } : { type: listType, items, start }
  }
  return { type: listType, items }
}

function lexicalBlock(nodeValue: unknown): OnMoveRichTextBlock {
  const node = record(nodeValue, 'stored rich-text block')
  if (node.type === 'paragraph') {
    return {
      type: 'paragraph',
      children: array(node.children, 'stored rich-text paragraph children').map(lexicalInline)
    }
  }
  if (node.type === 'list') return lexicalList(node)
  if (node.type === 'quote') {
    const children = array(node.children, 'stored rich-text quote children')
    const blocks = children.every((child) => {
      const type = record(child, 'stored rich-text quote child').type
      return type === 'paragraph' || type === 'list' || type === 'quote'
    })
      ? children.map(lexicalBlock)
      : [{ type: 'paragraph', children: children.map(lexicalInline) } satisfies OnMoveRichTextParagraph]
    return { type: 'quote', blocks }
  }
  throw new Error(`stored rich text contains unsupported block ${String(node.type)}`)
}

function legacyPlainTextDocument(value: string): OnMoveRichTextDocument {
  if (value === '') return { version: ONMOVE_RICH_TEXT_DOCUMENT_VERSION, blocks: [] }
  return {
    version: ONMOVE_RICH_TEXT_DOCUMENT_VERSION,
    blocks: value.split('\n').map((text) => ({
      type: 'paragraph',
      children: text ? [{ type: 'text', text }] : []
    }))
  }
}

/** Converts stored Lexical or legacy plain text into the stable API document. */
export function onMoveRichTextDocumentFromStored(value: string): OnMoveRichTextDocument {
  const serialized = serializedRichTextEditorState(value)
  if (!serialized) return legacyPlainTextDocument(value)
  const state = record(JSON.parse(serialized), 'stored rich-text document')
  const root = record(state.root, 'stored rich-text root')
  return assertOnMoveRichTextDocument({
    version: ONMOVE_RICH_TEXT_DOCUMENT_VERSION,
    blocks: array(root.children, 'stored rich-text root children').map(lexicalBlock)
  })
}

function validateText(value: unknown, budget: ValidationBudget, depth: number): OnMoveRichTextText {
  countNode(budget, depth)
  const text = record(value, 'rich-text text')
  assertAllowedKeys(text, ['type', 'text', 'marks', 'color', 'tag'], 'rich-text text')
  if (text.type !== 'text' || typeof text.text !== 'string') {
    throw new Error('rich-text text requires type=text and a text value')
  }
  countText(budget, text.text)
  const result: OnMoveRichTextText = { type: 'text', text: text.text }
  if (text.marks !== undefined) {
    const marks = array(text.marks, 'rich-text text marks')
    if (marks.some((mark) => typeof mark !== 'string' || !INPUT_MARKS.has(mark))) {
      throw new Error(
        'rich-text text marks must use bold, italic, underline, strikethrough, or highlight ' +
        '(highlight-yellow is accepted as an alias for the yellow highlight)'
      )
    }
    const canonicalMarks = marks.map((mark) => mark === 'highlight-yellow' ? 'highlight' : mark)
    if (new Set(canonicalMarks).size !== canonicalMarks.length) {
      throw new Error('rich-text text marks must not repeat the same formatting')
    }
    if (canonicalMarks.length > 0) {
      result.marks = ONMOVE_RICH_TEXT_MARKS.filter((mark) => canonicalMarks.includes(mark))
    }
  }
  if (text.color !== undefined) {
    if (typeof text.color !== 'string' || !COLORS.has(text.color)) {
      throw new Error('rich-text text color is unsupported')
    }
    result.color = text.color as OnMoveRichTextColor
  }
  if (text.tag !== undefined) {
    if (text.tag !== true || !TAG_PATTERN.test(text.text)) {
      throw new Error('rich-text tag text must be @ followed by alphanumeric characters')
    }
    result.tag = true
  }
  return result
}

function validateInline(
  value: unknown,
  budget: ValidationBudget,
  depth: number
): OnMoveRichTextInline {
  const inline = record(value, 'rich-text inline')
  if (inline.type === 'text') return validateText(inline, budget, depth)
  countNode(budget, depth)
  if (inline.type === 'line-break') {
    assertAllowedKeys(inline, ['type'], 'rich-text line break')
    return { type: 'line-break' }
  }
  if (inline.type === 'link') {
    assertAllowedKeys(inline, ['type', 'url', 'children'], 'rich-text link')
    if (typeof inline.url !== 'string' || !validLinkUrl(inline.url)) {
      throw new Error('rich-text link URL must use http, https, or mailto')
    }
    const children = array(inline.children, 'rich-text link children')
      .map((child) => validateText(child, budget, depth + 1))
    if (children.length === 0) throw new Error('rich-text link requires text')
    return { type: 'link', url: inline.url, children }
  }
  throw new Error(`unsupported rich-text inline type ${String(inline.type)}`)
}

function validateList(
  value: LexicalRecord,
  budget: ValidationBudget,
  depth: number
): OnMoveRichTextList {
  countNode(budget, depth)
  assertAllowedKeys(value, ['type', 'items', 'start'], 'rich-text list')
  if (!['bullet-list', 'numbered-list', 'checklist'].includes(String(value.type))) {
    throw new Error(`unsupported rich-text list type ${String(value.type)}`)
  }
  const type = value.type as OnMoveRichTextList['type']
  const items = array(value.items, 'rich-text list items').map((itemValue) => {
    countNode(budget, depth + 1)
    const item = record(itemValue, 'rich-text list item')
    assertAllowedKeys(item, ['content', 'checked', 'children'], 'rich-text list item')
    const result: OnMoveRichTextListItem = {
      content: array(item.content, 'rich-text list item content')
        .map((child) => validateInline(child, budget, depth + 2))
    }
    if (type === 'checklist') {
      if (item.checked !== undefined && typeof item.checked !== 'boolean') {
        throw new Error('checklist item checked must be boolean')
      }
      result.checked = item.checked === true
    } else if (item.checked !== undefined) {
      throw new Error('checked is valid only on checklist items')
    }
    if (item.children !== undefined) {
      const children = array(item.children, 'rich-text nested lists').map((child) => {
        const list = record(child, 'rich-text nested list')
        return validateList(list, budget, depth + 2)
      })
      if (children.length > 0) result.children = children
    }
    return result
  })
  if (items.length === 0) throw new Error('rich-text list requires at least one item')
  if (value.start !== undefined) {
    if (type !== 'numbered-list') throw new Error('start is valid only on numbered lists')
    if (!Number.isSafeInteger(value.start) || Number(value.start) < 1) {
      throw new Error('numbered-list start must be a positive integer')
    }
    if (value.start !== 1) return { type, items, start: Number(value.start) }
  }
  return { type, items }
}

function validateBlock(
  value: unknown,
  budget: ValidationBudget,
  depth: number
): OnMoveRichTextBlock {
  const block = record(value, 'rich-text block')
  if (block.type === 'paragraph') {
    countNode(budget, depth)
    assertAllowedKeys(block, ['type', 'children'], 'rich-text paragraph')
    return {
      type: 'paragraph',
      children: array(block.children, 'rich-text paragraph children')
        .map((child) => validateInline(child, budget, depth + 1))
    }
  }
  if (block.type === 'quote') {
    countNode(budget, depth)
    assertAllowedKeys(block, ['type', 'blocks'], 'rich-text quote')
    const blocks = array(block.blocks, 'rich-text quote blocks')
      .map((child) => validateBlock(child, budget, depth + 1))
    if (blocks.length === 0) throw new Error('rich-text quote requires at least one block')
    return { type: 'quote', blocks }
  }
  return validateList(block, budget, depth)
}

/** Validates and canonicalizes an untrusted API document. */
export function assertOnMoveRichTextDocument(value: unknown): OnMoveRichTextDocument {
  const document = record(value, 'rich-text document')
  assertAllowedKeys(document, ['version', 'blocks'], 'rich-text document')
  if (document.version !== ONMOVE_RICH_TEXT_DOCUMENT_VERSION) {
    throw new Error(`rich-text document version must be ${ONMOVE_RICH_TEXT_DOCUMENT_VERSION}`)
  }
  const budget: ValidationBudget = { nodes: 0, textLength: 0 }
  return {
    version: ONMOVE_RICH_TEXT_DOCUMENT_VERSION,
    blocks: array(document.blocks, 'rich-text document blocks')
      .map((block) => validateBlock(block, budget, 1))
  }
}

function lexicalTextFromApi(text: OnMoveRichTextText): LexicalRecord {
  const format = (text.marks ?? []).reduce((value, mark) => value | FORMAT_BITS[mark], 0)
  return {
    detail: 0,
    format,
    mode: 'normal',
    style: text.color ? `color: var(--rich-text-${text.color});` : '',
    text: text.text,
    type: text.tag ? 'tag' : 'text',
    version: 1
  }
}

function lexicalInlineFromApi(inline: OnMoveRichTextInline): LexicalRecord {
  if (inline.type === 'text') return lexicalTextFromApi(inline)
  if (inline.type === 'line-break') return { type: 'linebreak', version: 1 }
  return {
    children: inline.children.map(lexicalTextFromApi),
    direction: null,
    format: '',
    indent: 0,
    rel: 'noopener noreferrer',
    target: '_blank',
    title: null,
    type: 'link',
    url: inline.url,
    version: 1
  }
}

function lexicalElement(type: string, children: LexicalRecord[]): LexicalRecord {
  return { children, direction: null, format: '', indent: 0, type, version: 1 }
}

function lexicalListFromApi(list: OnMoveRichTextList): LexicalRecord {
  const listType = list.type === 'numbered-list'
    ? 'number'
    : list.type === 'checklist'
      ? 'check'
      : 'bullet'
  const start = list.type === 'numbered-list' ? list.start ?? 1 : 1
  return {
    ...lexicalElement('list', list.items.map((item, index) => ({
      ...lexicalElement('listitem', [
        ...item.content.map(lexicalInlineFromApi),
        ...(item.children ?? []).map(lexicalListFromApi)
      ]),
      ...(listType === 'check' ? { checked: item.checked === true } : {}),
      value: start + index
    }))),
    listType,
    start,
    tag: listType === 'number' ? 'ol' : 'ul'
  }
}

function lexicalBlockFromApi(block: OnMoveRichTextBlock): LexicalRecord {
  if (block.type === 'paragraph') {
    return lexicalElement('paragraph', block.children.map(lexicalInlineFromApi))
  }
  if (block.type === 'quote') {
    return {
      ...lexicalElement('quote', block.blocks.map(lexicalBlockFromApi)),
      shadowRoot: true
    }
  }
  return lexicalListFromApi(block)
}

/** Converts the stable API document into the app's versioned Lexical storage envelope. */
export function onMoveRichTextDocumentToStored(value: unknown): string {
  const document = assertOnMoveRichTextDocument(value)
  if (document.blocks.length === 0) return ''
  return `${RICH_TEXT_PREFIX}${JSON.stringify({
    root: lexicalElement('root', document.blocks.map(lexicalBlockFromApi))
  })}`
}
