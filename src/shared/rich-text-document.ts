import * as z from 'zod/v4'
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

const richTextMarkInputSchema = z.string().describe(
  `One of: ${ONMOVE_RICH_TEXT_INPUT_MARKS.join(', ')}. Runtime validation returns the exact invalid mark path and a correction.`
)
const richTextColorInputSchema = z.string().describe(
  `One of: ${ONMOVE_RICH_TEXT_COLORS.join(', ')}. Runtime validation returns the exact invalid color path and a correction.`
)

/**
 * Single structural definition used both for MCP JSON Schema advertisement and
 * runtime document parsing. Semantic checks that need richer recovery (URL
 * protocols, tag spelling, budgets) run immediately after this structural parse.
 */
export const onMoveRichTextTextSchema = z.strictObject({
  type: z.literal('text').describe('Discriminator for an ordinary visible text run.'),
  text: z.string().describe('Visible text. Example text run: {"type":"text","text":"Hello","marks":["bold"]}.'),
  marks: z.array(richTextMarkInputSchema).optional().describe(
    'Optional unique marks: bold, italic, underline, strikethrough, or highlight. highlight-yellow is accepted as an input alias.'
  ),
  color: richTextColorInputSchema.nullable().optional().describe(
    'Optional foreground color. Omit it when no color is intended; null is accepted and canonicalized to omission.'
  ),
  tag: z.literal(true).optional().describe(
    'Set only for a durable token whose complete text is @ followed by alphanumeric characters. Omit for ordinary text, including text inside links.'
  )
}).describe('rich-text text variant: type, text, optional marks, optional color, and optional valid tag marker.')

export const onMoveRichTextLineBreakSchema = z.strictObject({
  type: z.literal('line-break').describe('Discriminator for an intentional soft line break.')
}).describe('A structural soft line break: this variant has only type and never contains ordinary text.')

export const onMoveRichTextLinkSchema = z.strictObject({
  type: z.literal('link').describe('Discriminator for a clickable link.'),
  url: z.string().describe('An http, https, or mailto URL.'),
  children: z.array(onMoveRichTextTextSchema).min(1).describe(
    'Visible link text runs. Their tag field must be omitted.'
  )
}).describe('Link variant: type, URL, and one or more text children.')

export const onMoveRichTextInlineSchema = z.discriminatedUnion('type', [
  onMoveRichTextTextSchema,
  onMoveRichTextLinkSchema,
  onMoveRichTextLineBreakSchema
]).describe('Inline node discriminated explicitly by type.')

function richTextListVariants() {
  const ordinaryItem = z.strictObject({
    content: z.array(onMoveRichTextInlineSchema),
    children: z.array(onMoveRichTextListSchema).optional()
  })
  const checklistItem = z.strictObject({
    content: z.array(onMoveRichTextInlineSchema),
    checked: z.boolean().optional(),
    children: z.array(onMoveRichTextListSchema).optional()
  })
  return [
    z.strictObject({
      type: z.literal('bullet-list'),
      items: z.array(ordinaryItem).min(1)
    }).describe('Bullet-list variant.'),
    z.strictObject({
      type: z.literal('numbered-list'),
      start: z.number().int().positive().optional(),
      items: z.array(ordinaryItem).min(1)
    }).describe('Numbered-list variant.'),
    z.strictObject({
      type: z.literal('checklist'),
      items: z.array(checklistItem).min(1)
    }).describe('Checklist variant.')
  ] as const
}

export const onMoveRichTextListSchema: z.ZodType = z.lazy(() => z.discriminatedUnion(
  'type',
  richTextListVariants()
).describe('List block discriminated explicitly by type.'))

export const onMoveRichTextBlockSchema: z.ZodType = z.lazy(() => z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('paragraph'),
    children: z.array(onMoveRichTextInlineSchema)
  }).describe('Paragraph variant.'),
  ...richTextListVariants(),
  z.strictObject({
    type: z.literal('quote'),
    blocks: z.array(onMoveRichTextBlockSchema).min(1)
  }).describe('Quote variant containing complete blocks.')
]).describe('Block discriminated explicitly by type.'))

export const onMoveRichTextDocumentSchema = z.strictObject({
  version: z.literal(ONMOVE_RICH_TEXT_DOCUMENT_VERSION),
  blocks: z.array(onMoveRichTextBlockSchema)
}).describe(
  'Complete editor-neutral rich-text document. Ordinary example: {"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Hello world","marks":["bold"]}]}]}.'
)

export interface OnMoveRichTextValidationIssue {
  pointer: string
  message: string
  received: unknown
  correction: unknown
}

/** Structured rich-text validation failure used to produce actionable MCP recovery. */
export class OnMoveRichTextValidationError extends Error {
  constructor(readonly issue: OnMoveRichTextValidationIssue) {
    super(issue.message)
    this.name = 'OnMoveRichTextValidationError'
  }
}

export interface OnMoveRichTextPatch {
  /** Exact, case-sensitive text to locate within one paragraph or list-item flow. */
  findText: string
  /** Replacement text. Omit for a formatting-only patch; an empty string deletes the match. */
  replaceText?: string
  /** One-based occurrence in document order. Omit only when the match is unique. */
  occurrence?: number
  addMarks?: OnMoveRichTextMark[]
  removeMarks?: OnMoveRichTextMark[]
}

export type OnMoveRichTextPatchIssueCode =
  | 'NOTE_TEXT_NOT_FOUND'
  | 'NOTE_TEXT_AMBIGUOUS'
  | 'NOTE_TEXT_OCCURRENCE_OUT_OF_RANGE'
  | 'NOTE_TEXT_PATCH_INVALID'

/** A recoverable semantic-patch failure suitable for an MCP response. */
export class OnMoveRichTextPatchError extends Error {
  constructor(
    readonly code: OnMoveRichTextPatchIssueCode,
    message: string,
    readonly matchCount: number
  ) {
    super(message)
    this.name = 'OnMoveRichTextPatchError'
  }
}

export interface OnMoveRichTextPatchResult {
  document: OnMoveRichTextDocument
  matchCount: number
  appliedOccurrence: number
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

type JsonPath = Array<string | number>

function jsonPointer(path: readonly (PropertyKey | number)[]): string {
  if (path.length === 0) return '/'
  return `/${path.map((segment) => String(segment)
    .replace(/~/gu, '~0')
    .replace(/\//gu, '~1')).join('/')}`
}

function valueAtPath(value: unknown, path: readonly (PropertyKey | number)[]): unknown {
  let current = value
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<PropertyKey, unknown>)[segment]
  }
  return current
}

function ordinaryTextCorrection(text = 'hey there'): OnMoveRichTextText {
  return { type: 'text', text, marks: ['bold', 'highlight'] }
}

function structuralValidationError(value: unknown, error: z.ZodError): OnMoveRichTextValidationError {
  const issue = error.issues[0]
  const received = valueAtPath(value, issue.path)
  const pointer = jsonPointer(issue.path)
  const type = received && typeof received === 'object' && !Array.isArray(received)
    ? (received as Record<string, unknown>).type
    : undefined
  const checkedOutsideChecklist = received && typeof received === 'object' &&
    !Array.isArray(received) && 'checked' in received
  const detail = checkedOutsideChecklist
    ? 'checked is valid only on checklist items; remove checked or change the containing list type to checklist.'
    : type === undefined
      ? issue.message
      : `received node type ${JSON.stringify(type)}; ${issue.message}`
  const correction = checkedOutsideChecklist
    ? Object.fromEntries(Object.entries(received as Record<string, unknown>)
        .filter(([key]) => key !== 'checked'))
    : ordinaryTextCorrection(
        received && typeof received === 'object' &&
          typeof (received as Record<string, unknown>).text === 'string'
          ? String((received as Record<string, unknown>).text)
          : 'hey there'
      )
  return new OnMoveRichTextValidationError({
    pointer,
    message: `${pointer} ${detail}`,
    received,
    correction
  })
}

function semanticValidationError(
  path: JsonPath,
  message: string,
  received: unknown,
  correction: unknown
): never {
  const pointer = jsonPointer(path)
  throw new OnMoveRichTextValidationError({
    pointer,
    message: `${pointer} ${message}`,
    received,
    correction
  })
}

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

function validateText(
  value: unknown,
  budget: ValidationBudget,
  depth: number,
  path: JsonPath,
  insideLink = false
): OnMoveRichTextText {
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
    const invalidMark = marks.findIndex((mark) =>
      typeof mark !== 'string' || !INPUT_MARKS.has(mark))
    if (invalidMark >= 0) {
      semanticValidationError(
        [...path, 'marks', invalidMark],
        'marks must use bold, italic, underline, strikethrough, or highlight ' +
        '(highlight-yellow is accepted as an alias).',
        marks[invalidMark],
        'highlight'
      )
    }
    const canonicalMarks = marks.map((mark) => mark === 'highlight-yellow' ? 'highlight' : mark)
    if (new Set(canonicalMarks).size !== canonicalMarks.length) {
      semanticValidationError(
        [...path, 'marks'],
        'marks must not repeat the same formatting.',
        marks,
        [...new Set(canonicalMarks)]
      )
    }
    if (canonicalMarks.length > 0) {
      result.marks = ONMOVE_RICH_TEXT_MARKS.filter((mark) => canonicalMarks.includes(mark))
    }
  }
  if (text.color !== undefined && text.color !== null) {
    if (typeof text.color !== 'string' || !COLORS.has(text.color)) {
      semanticValidationError(
        [...path, 'color'],
        `color must be one of ${ONMOVE_RICH_TEXT_COLORS.join(', ')}, null, or omitted.`,
        text.color,
        null
      )
    }
    result.color = text.color as OnMoveRichTextColor
  }
  if (text.tag !== undefined) {
    if (text.tag !== true || !TAG_PATTERN.test(text.text)) {
      semanticValidationError(
        path,
        `${insideLink ? 'received a tagged link text node' : 'received a tagged text node'}, ` +
        `but ${JSON.stringify(text.text)} is not @ followed only by alphanumeric characters. ` +
        'Remove tag:true for ordinary text.',
        text,
        ordinaryTextCorrection(text.text)
      )
    }
    if (insideLink) {
      semanticValidationError(
        path,
        `received a tagged link text node. Link text cannot also be a durable tag; remove tag:true.`,
        text,
        ordinaryTextCorrection(text.text)
      )
    }
    result.tag = true
  }
  return result
}

function validateInline(
  value: unknown,
  budget: ValidationBudget,
  depth: number,
  path: JsonPath
): OnMoveRichTextInline {
  const inline = record(value, 'rich-text inline')
  if (inline.type === 'text') return validateText(inline, budget, depth, path)
  countNode(budget, depth)
  if (inline.type === 'line-break') {
    assertAllowedKeys(inline, ['type'], 'rich-text line break')
    return { type: 'line-break' }
  }
  if (inline.type === 'link') {
    assertAllowedKeys(inline, ['type', 'url', 'children'], 'rich-text link')
    if (typeof inline.url !== 'string' || !validLinkUrl(inline.url)) {
      semanticValidationError(
        [...path, 'url'],
        'link URL must use http, https, or mailto.',
        inline.url,
        'https://example.com'
      )
    }
    const children = array(inline.children, 'rich-text link children')
      .map((child, index) => validateText(
        child,
        budget,
        depth + 1,
        [...path, 'children', index],
        true
      ))
    if (children.length === 0) throw new Error('rich-text link requires text')
    return { type: 'link', url: inline.url, children }
  }
  throw new Error(`unsupported rich-text inline type ${String(inline.type)}`)
}

function validateList(
  value: LexicalRecord,
  budget: ValidationBudget,
  depth: number,
  path: JsonPath
): OnMoveRichTextList {
  countNode(budget, depth)
  assertAllowedKeys(value, ['type', 'items', 'start'], 'rich-text list')
  if (!['bullet-list', 'numbered-list', 'checklist'].includes(String(value.type))) {
    throw new Error(`unsupported rich-text list type ${String(value.type)}`)
  }
  const type = value.type as OnMoveRichTextList['type']
  const items = array(value.items, 'rich-text list items').map((itemValue, itemIndex) => {
    countNode(budget, depth + 1)
    const item = record(itemValue, 'rich-text list item')
    assertAllowedKeys(item, ['content', 'checked', 'children'], 'rich-text list item')
    const result: OnMoveRichTextListItem = {
      content: array(item.content, 'rich-text list item content')
        .map((child, childIndex) => validateInline(
          child,
          budget,
          depth + 2,
          [...path, 'items', itemIndex, 'content', childIndex]
        ))
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
      const children = array(item.children, 'rich-text nested lists').map((child, childIndex) => {
        const list = record(child, 'rich-text nested list')
        return validateList(
          list,
          budget,
          depth + 2,
          [...path, 'items', itemIndex, 'children', childIndex]
        )
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
  depth: number,
  path: JsonPath
): OnMoveRichTextBlock {
  const block = record(value, 'rich-text block')
  if (block.type === 'paragraph') {
    countNode(budget, depth)
    assertAllowedKeys(block, ['type', 'children'], 'rich-text paragraph')
    return {
      type: 'paragraph',
      children: array(block.children, 'rich-text paragraph children')
        .map((child, index) => validateInline(
          child,
          budget,
          depth + 1,
          [...path, 'children', index]
        ))
    }
  }
  if (block.type === 'quote') {
    countNode(budget, depth)
    assertAllowedKeys(block, ['type', 'blocks'], 'rich-text quote')
    const blocks = array(block.blocks, 'rich-text quote blocks')
      .map((child, index) => validateBlock(
        child,
        budget,
        depth + 1,
        [...path, 'blocks', index]
      ))
    if (blocks.length === 0) throw new Error('rich-text quote requires at least one block')
    return { type: 'quote', blocks }
  }
  return validateList(block, budget, depth, path)
}

/** Validates and canonicalizes an untrusted API document. */
export function assertOnMoveRichTextDocument(value: unknown): OnMoveRichTextDocument {
  const parsed = onMoveRichTextDocumentSchema.safeParse(value)
  if (!parsed.success) throw structuralValidationError(value, parsed.error)
  const document = record(parsed.data, 'rich-text document')
  const budget: ValidationBudget = { nodes: 0, textLength: 0 }
  return {
    version: ONMOVE_RICH_TEXT_DOCUMENT_VERSION,
    blocks: array(document.blocks, 'rich-text document blocks')
      .map((block, index) => validateBlock(block, budget, 1, ['blocks', index]))
  }
}

interface InlineFlow {
  content: OnMoveRichTextInline[]
  text: string
}

interface InlineFlowMatch {
  flow: InlineFlow
  start: number
  end: number
}

function inlineFlowText(content: OnMoveRichTextInline[]): string {
  return content.map((inline) => inline.type === 'text'
    ? inline.text
    : inline.type === 'link'
      ? inline.children.map((child) => child.text).join('')
      : '\n').join('')
}

function collectInlineFlows(blocks: OnMoveRichTextBlock[], result: InlineFlow[]): void {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      result.push({ content: block.children, text: inlineFlowText(block.children) })
      continue
    }
    if (block.type === 'quote') {
      collectInlineFlows(block.blocks, result)
      continue
    }
    for (const item of block.items) {
      result.push({ content: item.content, text: inlineFlowText(item.content) })
      for (const child of item.children ?? []) collectInlineFlows([child], result)
    }
  }
}

function marksAfterPatch(
  source: OnMoveRichTextText,
  addMarks: readonly OnMoveRichTextMark[],
  removeMarks: readonly OnMoveRichTextMark[]
): OnMoveRichTextMark[] | undefined {
  const marks = new Set(source.marks ?? [])
  for (const mark of removeMarks) marks.delete(mark)
  for (const mark of addMarks) marks.add(mark)
  const ordered = ONMOVE_RICH_TEXT_MARKS.filter((mark) => marks.has(mark))
  return ordered.length > 0 ? ordered : undefined
}

function textFragment(
  source: OnMoveRichTextText,
  text: string,
  options: {
    replaceMarks?: boolean
    marks?: OnMoveRichTextMark[]
    preserveTag?: boolean
  } = {}
): OnMoveRichTextText {
  const result: OnMoveRichTextText = { ...source, text }
  if (options.replaceMarks) {
    if (options.marks) result.marks = options.marks
    else delete result.marks
  }
  if (!options.preserveTag || !/^@[A-Za-z0-9]+$/u.test(text)) delete result.tag
  return result
}

function patchedLeaf(
  source: OnMoveRichTextText,
  leafStart: number,
  match: InlineFlowMatch,
  patch: OnMoveRichTextPatch,
  replacementState: { inserted: boolean }
): OnMoveRichTextText[] {
  const leafEnd = leafStart + source.text.length
  if (match.end <= leafStart || match.start >= leafEnd || source.text.length === 0) {
    return [source]
  }
  const from = Math.max(0, match.start - leafStart)
  const to = Math.min(source.text.length, match.end - leafStart)
  const prefix = source.text.slice(0, from)
  const selected = source.text.slice(from, to)
  const suffix = source.text.slice(to)
  const result: OnMoveRichTextText[] = []
  if (prefix) result.push(textFragment(source, prefix))

  const marks = marksAfterPatch(source, patch.addMarks ?? [], patch.removeMarks ?? [])
  if (patch.replaceText === undefined) {
    if (selected) {
      result.push(textFragment(
        source,
        selected,
        {
          replaceMarks: true,
          marks,
          preserveTag: from === 0 && to === source.text.length
        }
      ))
    }
  } else if (!replacementState.inserted) {
    replacementState.inserted = true
    if (patch.replaceText) {
      result.push(textFragment(
        source,
        patch.replaceText,
        {
          replaceMarks: true,
          marks,
          preserveTag: from === 0 && to === source.text.length
        }
      ))
    }
  }

  if (suffix) result.push(textFragment(source, suffix))
  return result
}

function sameTextStyle(left: OnMoveRichTextText, right: OnMoveRichTextText): boolean {
  return left.color === right.color && left.tag === right.tag &&
    JSON.stringify(left.marks ?? []) === JSON.stringify(right.marks ?? [])
}

function mergeTextRuns(children: OnMoveRichTextText[]): OnMoveRichTextText[] {
  const result: OnMoveRichTextText[] = []
  for (const child of children) {
    const previous = result.at(-1)
    if (previous && sameTextStyle(previous, child) && !previous.tag && !child.tag) {
      previous.text += child.text
    } else {
      result.push(child)
    }
  }
  return result
}

function compactInlineRuns(content: OnMoveRichTextInline[]): OnMoveRichTextInline[] {
  const result: OnMoveRichTextInline[] = []
  for (const inline of content) {
    if (inline.type === 'link') {
      result.push({ ...inline, children: mergeTextRuns(inline.children) })
      continue
    }
    if (inline.type === 'text') {
      const previous = result.at(-1)
      if (previous?.type === 'text' && sameTextStyle(previous, inline) &&
          !previous.tag && !inline.tag) {
        previous.text += inline.text
      } else {
        result.push(inline)
      }
      continue
    }
    result.push(inline)
  }
  return result
}

function patchInlineFlow(match: InlineFlowMatch, patch: OnMoveRichTextPatch): void {
  let cursor = 0
  const replacementState = { inserted: false }
  const content: OnMoveRichTextInline[] = []
  for (const inline of match.flow.content) {
    if (inline.type === 'line-break') {
      content.push(inline)
      cursor += 1
      continue
    }
    if (inline.type === 'text') {
      content.push(...patchedLeaf(inline, cursor, match, patch, replacementState))
      cursor += inline.text.length
      continue
    }
    const children: OnMoveRichTextText[] = []
    for (const child of inline.children) {
      children.push(...patchedLeaf(child, cursor, match, patch, replacementState))
      cursor += child.text.length
    }
    if (children.length > 0) content.push({ ...inline, children })
  }
  match.flow.content.splice(0, match.flow.content.length, ...compactInlineRuns(content))
}

/**
 * Applies one exact semantic text patch without rebuilding unrelated rich-text nodes.
 * Matches may cross adjacent formatted runs or link boundaries, but never structural
 * paragraph/list-item boundaries or explicit line-break nodes.
 */
export function patchOnMoveRichTextDocument(
  value: unknown,
  patch: OnMoveRichTextPatch
): OnMoveRichTextPatchResult {
  const document = assertOnMoveRichTextDocument(value)
  if (!patch || typeof patch !== 'object' ||
      typeof patch.findText !== 'string' || patch.findText.length === 0) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_PATCH_INVALID',
      'findText must contain the exact non-empty text to patch.',
      0
    )
  }
  if (/\r|\n/u.test(patch.findText)) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_PATCH_INVALID',
      'findText cannot cross a structural line or block boundary; use the field\'s full-document update tool for structural edits.',
      0
    )
  }
  if (
    patch.replaceText === undefined &&
    (patch.addMarks?.length ?? 0) === 0 &&
    (patch.removeMarks?.length ?? 0) === 0
  ) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_PATCH_INVALID',
      'Provide replaceText, addMarks, or removeMarks.',
      0
    )
  }
  if (patch.occurrence !== undefined && (
    !Number.isSafeInteger(patch.occurrence) || patch.occurrence < 1
  )) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_PATCH_INVALID',
      'occurrence must be a one-based positive integer.',
      0
    )
  }
  const overlap = (patch.addMarks ?? []).find((mark) => patch.removeMarks?.includes(mark))
  if (overlap) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_PATCH_INVALID',
      `The same mark cannot be both added and removed: ${overlap}.`,
      0
    )
  }

  const flows: InlineFlow[] = []
  collectInlineFlows(document.blocks, flows)
  const matches: InlineFlowMatch[] = []
  for (const flow of flows) {
    let offset = 0
    while (offset <= flow.text.length - patch.findText.length) {
      const start = flow.text.indexOf(patch.findText, offset)
      if (start < 0) break
      matches.push({ flow, start, end: start + patch.findText.length })
      offset = start + patch.findText.length
    }
  }
  if (matches.length === 0) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_NOT_FOUND',
      `The exact text ${JSON.stringify(patch.findText)} was not found in the rich-text field.`,
      0
    )
  }
  if (patch.occurrence === undefined && matches.length > 1) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_AMBIGUOUS',
      `The exact text ${JSON.stringify(patch.findText)} occurs ${matches.length} times. ` +
      'Retry with a one-based occurrence.',
      matches.length
    )
  }
  const occurrence = patch.occurrence ?? 1
  if (occurrence > matches.length) {
    throw new OnMoveRichTextPatchError(
      'NOTE_TEXT_OCCURRENCE_OUT_OF_RANGE',
      `Occurrence ${occurrence} was requested, but the exact text occurs ${matches.length} times.`,
      matches.length
    )
  }
  patchInlineFlow(matches[occurrence - 1], patch)
  return {
    document: assertOnMoveRichTextDocument(document),
    matchCount: matches.length,
    appliedOccurrence: occurrence
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
